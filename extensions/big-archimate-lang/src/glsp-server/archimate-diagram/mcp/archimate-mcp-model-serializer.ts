import {
   ARCHIMATE_ELEMENT_TYPE_MAP,
   ARCHIMATE_JUNCTION_TYPE_MAP,
   ARCHIMATE_NODE_TYPE_MAP,
   ARCHIMATE_RELATION_TYPE_MAP,
   getLayer,
   isElementType,
   isJunctionType,
   isRelationType,
   layerTypes
} from '@big-archimate/protocol';
import { DefaultTypes, GModelElement } from '@eclipse-glsp/server';
import {
   MarkdownMcpModelSerializer,
   McpLabelProvider,
   McpStructuredContent,
   SerializedElement,
   objectArrayToMarkdownTable
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';
import { ElementType, JunctionType } from '../../../language-server/generated/ast.js';
import { GElementNode } from '../model/nodes.js';

/**
 * This sub bucket comprises all elements of a specfic layer and is part of the layer's bucket.
 */
const ELEMENTS_SUB_BUCKET = 'elements';
/**
 * This sub bucket comprises all relations whose elements belong to the same layer and is part of the layer's bucket.
 */
const RELATIONS_SUB_BUCKET = 'relations';
/**
 * This bucket comprises all concepts that cannot be assigned to
 * a specific layer, such as junctions, groupings, and the graph itself.
 * It's on the same level as the layer buckets, but has sub-buckets for junctions, groupings, and cross-layer relations.
 */
const OTHER_BUCKET = 'Other';
/**
 * This is a sub-bucket of the 'Other' bucket,
 * which is used for relations that connect elements from different layers, junctions, or groupings.
 */
const CROSSLAYER_RELATIONS_SUB_BUCKET = 'crosslayer relations';
/**
 * This is a sub-bucket of the 'Other' bucket used for junctions.
 * Junctions are always assigned to the 'Other' bucket, no matter if
 * all connected relations of a single junction are connected to elements from the same layer or not.
 */
const JUNCTION_SUB_BUCKET = 'junctions';
/**
 * This is a sub-bucket of the 'Other' bucket used for groupings.
 * Groupings are always assigned to the 'Other' bucket, no matter if
 * all their elements they include are from the same layer or not.
 */
const GROUPING_SUB_BUCKET = 'groupings';
/**
 * This is a sub-bucket of the 'Other' bucket used for the graph itself.
 */
const GRAPH_SUB_BUCKET = 'graph';

/**
 * Groups ArchiMate concepts by their layer (Business, Application, Technology, ...),
 * so the diagram's serialization the LLM sees mirrors the way an enterprise architect
 * reads a model.
 */
@injectable()
export class ArchiMateMcpModelSerializer extends MarkdownMcpModelSerializer {
   @inject(McpLabelProvider) protected labelProvider: McpLabelProvider;

   override serializeArray(elements: GModelElement[]): string {
      const buckets = this.archiMateBuildAliasedTypeBuckets(elements);

      /**
       * @experimental
       * This is a makeshift solution. If later evalutation shows both markdown and json approachs
       * have their reight to exist (e.g., one approach is more token efficient, but generates worse diagrams),
       * the user will be able to choose his/her preferred option in the app's settings.
       */
      const isJson = true;

      if (isJson) {
         return JSON.stringify(this.bucketsToJson(buckets));
      } else {
         return this.bucketsToMarkdown(buckets);
      }
   }

   override serializeStructuredArray(elements: GModelElement[]): McpStructuredContent {
      const buckets = this.archiMateBuildAliasedTypeBuckets(elements);

      return this.bucketsToJson(buckets);
   }

   private bucketsToJson(buckets: Record<string, Record<string, SerializedElement[]>>): McpStructuredContent {
      Object.keys(buckets).forEach(layer => {
         const bucket = buckets[layer];

         Object.keys(bucket).forEach(subBucketName => {
            if (bucket[subBucketName].length === 0) {
               delete bucket[subBucketName];
            }
         });

         if (Object.keys(bucket).length === 0) {
            delete buckets[layer];
         }
      });
      return buckets;
   }

   private bucketsToMarkdown(buckets: Record<string, Record<string, SerializedElement[]>>): string {
      return Object.entries(buckets)
         .flatMap(([layer, bucket]) => {
            const subBuckets = Object.entries(bucket).filter(([, subBucket]) => subBucket.length > 0);

            if (subBuckets.length === 0) {
               return [];
            }

            return [
               `# ${layer}`,
               ...subBuckets.flatMap(([subBucketName, subBucket]) => [`## ${subBucketName}`, objectArrayToMarkdownTable(subBucket)])
            ];
         })
         .filter(([, bucket]) => bucket.length > 0)
         .join('\n');
   }

   protected archiMateBuildAliasedTypeBuckets(elements: GModelElement[]): Record<string, Record<string, SerializedElement[]>> {
      const conceptsByLayerArray = elements.map(element => this.archiMatePrepareElement(element));
      const result: Record<string, Record<string, SerializedElement[]>> = {};
      const allKeys = new Set(conceptsByLayerArray.flatMap(obj => Object.keys(obj)));

      allKeys.forEach(layer => {
         let combinedBucket: Record<string, SerializedElement[]> = {};
         for (const conceptsByLayer of conceptsByLayerArray) {
            for (const subBucketName of Object.keys(conceptsByLayer[layer] || {})) {
               combinedBucket[subBucketName] = [
                  ...(combinedBucket[subBucketName] || []),
                  ...(conceptsByLayer[layer]?.[subBucketName] || [])
               ];
            }
         }
         result[layer] = Object.fromEntries(
            Object.entries(combinedBucket).map(([subBucketName, subBucket]) => [
               subBucketName,
               Array.from(new Map(subBucket.map(concept => [concept.id, concept])).values()).map(concept => this.applyAlias(concept))
            ])
         );
      });

      return result;
   }

   protected archiMatePrepareElement(element: GModelElement): Record<string, Record<string, SerializedElement[]>> {
      const flat = this.flattenStructure(element as unknown as SerializedElement, element.parent?.id);
      const flatMap = new Map<string, ElementType | JunctionType | undefined>(
         flat.map(e => [e.id, e.type] as [string, ElementType | JunctionType | undefined])
      );

      const buckets: Record<string, Record<string, SerializedElement[]>> = {
         ...Object.fromEntries(
            layerTypes.map(layer => [
               layer,
               {
                  [ELEMENTS_SUB_BUCKET]: [],
                  [RELATIONS_SUB_BUCKET]: []
               }
            ])
         ),
         [OTHER_BUCKET]: {
            [JUNCTION_SUB_BUCKET]: [],
            [GROUPING_SUB_BUCKET]: [],
            [CROSSLAYER_RELATIONS_SUB_BUCKET]: [],
            [GRAPH_SUB_BUCKET]: []
         }
      };

      for (const serialized of flat) {
         this.combinePositionAndSize(serialized);
         const adjusted = this.adjustElement(serialized);
         if (!adjusted) {
            continue;
         }
         const bucket = this.bucketFor(adjusted, flatMap);
         const subBucket = this.subBucketFor(adjusted, bucket);
         buckets[bucket][subBucket].push(adjusted);
      }

      return buckets;
   }

   protected bucketFor(element: SerializedElement, elementIdToTypeMap: Map<string, ElementType | JunctionType | undefined>): string {
      const concept = element.element ?? element.junction ?? element.relation;

      if (typeof concept !== 'string') {
         return OTHER_BUCKET;
      }

      if (isElementType(concept) || isJunctionType(concept)) {
         return getLayer(concept);
      }

      if (isRelationType(concept)) {
         const sourceNodeType = elementIdToTypeMap.get(element.sourceId as string);
         const targetNodeType = elementIdToTypeMap.get(element.targetId as string);

         if (!targetNodeType || !sourceNodeType) {
            return OTHER_BUCKET;
         }

         const sourceElement = ARCHIMATE_NODE_TYPE_MAP.getReverse(sourceNodeType);
         const targetElement = ARCHIMATE_NODE_TYPE_MAP.getReverse(targetNodeType);
         const sourceLayer = getLayer(sourceElement);
         const targetLayer = getLayer(targetElement);

         if (targetLayer !== sourceLayer) {
            return OTHER_BUCKET;
         }

         return targetLayer;
      }

      return OTHER_BUCKET;
   }

   protected subBucketFor(element: SerializedElement, bucket: string): string {
      if (bucket === OTHER_BUCKET) {
         if (element.relation) {
            return CROSSLAYER_RELATIONS_SUB_BUCKET;
         } else if (element.type === DefaultTypes.GRAPH) {
            return GRAPH_SUB_BUCKET;
         } else if (element.junction) {
            return JUNCTION_SUB_BUCKET;
         }

         return GROUPING_SUB_BUCKET;
      } else {
         if (element.relation) {
            return RELATIONS_SUB_BUCKET;
         }

         return ELEMENTS_SUB_BUCKET;
      }
   }

   /**
    * This function determines which attributes of each concept the LLM sees.
    * Each concept gets, in addition to its type, the ArchiMate concept name attached so the LLM can
    * refer to a 'junction: Or' rather than just a 'type: node:circle:or'. Although the bounds could be
    * calculated from position and size, including them saves the LLM from calculating them on its own,
    * which has been shown to be very costly.
    */
   protected adjustElement(element: SerializedElement): SerializedElement | undefined {
      const type = element.type;

      if (typeof type !== 'string') {
         return undefined;
      }

      if (type === DefaultTypes.GRAPH) {
         return {
            id: element.id,
            type
         };
      }

      const relationConcept = ARCHIMATE_RELATION_TYPE_MAP.getReverse(type);
      if (relationConcept) {
         return {
            id: element.id,
            type,
            relation: relationConcept,
            sourceId: element.sourceId,
            targetId: element.targetId
         };
      }

      const elementConcept = ARCHIMATE_ELEMENT_TYPE_MAP.getReverse(type);
      if (elementConcept) {
         return {
            id: element.id,
            type,
            element: elementConcept,
            label: this.labelProvider.getLabel(element as unknown as GElementNode)?.text,
            position: element.position,
            size: element.size,
            bounds: element.bounds
         };
      }

      const junctionConcept = ARCHIMATE_JUNCTION_TYPE_MAP.getReverse(type);
      if (junctionConcept) {
         return {
            id: element.id,
            type,
            junction: junctionConcept,
            position: element.position,
            size: element.size,
            bounds: element.bounds
         };
      }

      // Icons, corner types and anything else GLSP emits are dropped from MCP output to reduce
      // context noise; the LLM does not need to know about visual sub-elements.
      return undefined;
   }
}

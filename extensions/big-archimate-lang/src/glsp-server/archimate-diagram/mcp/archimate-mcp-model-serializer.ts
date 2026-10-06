import {
   ARCHIMATE_ELEMENT_TYPE_MAP,
   ARCHIMATE_JUNCTION_TYPE_MAP,
   ARCHIMATE_NODE_TYPE_MAP,
   ARCHIMATE_RELATION_TYPE_MAP,
   LayerType,
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
import {
   ArchiMateEdgeOutputSchema,
   ArchiMateLayerOutputSchema,
   ArchiMateNodeOutputSchema
} from './tools/handlers/structured-archimate-model-mcp-tool-handler.js';

/**
 * All bucket names follow the GLSP naming convention (elements, nodes, edges) rather than the
 * ArchiMate naming convention (concepts, elements, relations) to avoid confusing the LLM,
 * as all other tools adhere to GLSP standards.
 */

export const NODES_SUB_BUCKET = 'nodes';
export const EDGES_SUB_BUCKET = 'edges';
export const OTHER_BUCKET = 'Other';

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
      const diagramLayers: ArchiMateLayerOutputSchema[] = [];

      Object.keys(buckets).forEach(layerName => {
         const nodes = buckets[layerName][NODES_SUB_BUCKET];
         const edges = buckets[layerName][EDGES_SUB_BUCKET];

         const layer: ArchiMateLayerOutputSchema = { name: layerName as LayerType };

         if (nodes && nodes.length > 0) {
            layer.nodes = nodes as ArchiMateNodeOutputSchema[];
         }

         if (edges && edges.length > 0) {
            layer.edges = edges as ArchiMateEdgeOutputSchema[];
         }

         if (layer.nodes || layer.edges) {
            diagramLayers.push(layer);
         }
      });

      return { layers: diagramLayers };
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
               ...subBuckets.flatMap(([subBucketName, subBucket]) => [
                  `## ${subBucketName}`,
                  objectArrayToMarkdownTable(subBucket.map(this.formatObjectForMarkdownTable))
               ])
            ];
         })
         .filter(([, bucket]) => bucket.length > 0)
         .join('\n');
   }

   private formatObjectForMarkdownTable(element: SerializedElement): SerializedElement {
      const formattedElement: SerializedElement = {};

      for (const [key, value] of Object.entries(element)) {
         if (typeof value !== 'object' || value === undefined) {
            formattedElement[key] = value;
            continue;
         }
         const obj = value as SerializedElement;
         const subKeys = Object.keys(obj).join(', ');
         const subValues = Object.values(obj).join(', ');
         formattedElement[`${key} (${subKeys})`] = subValues;
      }

   return formattedElement;
}

   protected archiMateBuildAliasedTypeBuckets(elements: GModelElement[]): Record<string, Record<string, SerializedElement[]>> {
      const conceptsByLayerArray = elements.map(element => this.archiMatePrepareElement(element));
      const result: Record<string, Record<string, SerializedElement[]>> = {};
      const allKeys = new Set(conceptsByLayerArray.flatMap(obj => Object.keys(obj)));

      allKeys.forEach(layer => {
         const combinedBucket: Record<string, SerializedElement[]> = {};
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

      const buckets: Record<string, Record<string, SerializedElement[]>> =
         Object.fromEntries(
            layerTypes.map(layer => [
               layer,
               {
                  [NODES_SUB_BUCKET]: [],
                  [EDGES_SUB_BUCKET]: []
               }
            ])
         );

      for (const serialized of flat) {
         this.combinePositionAndSize(serialized);
         const adjusted = this.adjustElement(serialized);
         if (!adjusted) {
            continue;
         }
         const bucket = this.bucketFor(serialized, flatMap);
         let subBucket = NODES_SUB_BUCKET;
         const relation = ARCHIMATE_RELATION_TYPE_MAP.getReverse(serialized.type as string);
         if (relation) {
            subBucket = EDGES_SUB_BUCKET;
         }

         buckets[bucket][subBucket].push(adjusted);
      }

      return buckets;
   }

   protected bucketFor(element: SerializedElement, elementIdToTypeMap: Map<string, ElementType | JunctionType | undefined>): string {
      const type = element.type as string;
      const concept = ARCHIMATE_ELEMENT_TYPE_MAP.getReverse(type) ??
                        ARCHIMATE_JUNCTION_TYPE_MAP.getReverse(type) ??
                        ARCHIMATE_RELATION_TYPE_MAP.getReverse(type);

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

   /**
    * This function determines which attributes of each concept the LLM sees.
    * Although the bounds could be calculated from position and size, including
    * them saves the LLM from calculating them on its own, which has been shown to be very costly.
    */
   protected adjustElement(element: SerializedElement): SerializedElement | undefined {
      const type = element.type;

      if (typeof type !== 'string' || type === DefaultTypes.GRAPH) { // The graph element is irrelevant to the LLM so it's dropped.
         return undefined;
      }

      const relationConcept = ARCHIMATE_RELATION_TYPE_MAP.getReverse(type);
      if (relationConcept) {
         return {
            id: element.id,
            elementTypeId: type,
            sourceElementId: this.aliasService.alias(element.sourceId as string),
            targetElementId: this.aliasService.alias(element.targetId as string)
         };
      }

      const elementConcept = ARCHIMATE_ELEMENT_TYPE_MAP.getReverse(type);
      if (elementConcept) {
         return {
            id: element.id,
            elementTypeId: type,
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
            elementTypeId: type,
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

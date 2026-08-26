import { ARCHIMATE_NODE_TYPE_MAP, ARCHIMATE_RELATION_TYPE_MAP, isElementType } from '@big-archimate/protocol';
import { ChangeRoutingPointsOperation, CreateEdgeOperation, GModelElement } from '@eclipse-glsp/server';
import {
   CreateEdgesInput,
   CreateEdgesMcpToolHandler,
   CreateEdgesValidationResultSchema,
   ElementIdentity,
   formatNoticeList,
   McpToolResult
} from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';
import { RelationValidator } from '../../../../../language-server/util/validation/relation-validator.js';

type EdgeInput = CreateEdgesInput['edges'][number];
type ValidationResult = z.infer<typeof CreateEdgesValidationResultSchema>;

/**
 * Extends default CreateEdgesMcpToolhandler to fix edge validation
 * and add a more detailed response when validation fails.
 */
@injectable()
export class ArchiMateCreateEdgesMcpToolHandler extends CreateEdgesMcpToolHandler {
   protected override runDryRun(edges: EdgeInput[]): McpToolResult {
      const validationResults: ValidationResult[] = edges.map(edge => this.validateEdge(edge));
      const validCount = validationResults.filter(result => result.isValid).length;
      const summary =
         `Dry run: validated ${edges.length} edge(s); ${validCount} would be accepted, ${edges.length - validCount} rejected.\n` +
         validationResults
            .map(
               result =>
                  `- ${result.edgeType} ${result.sourceElementId} → ${result.targetElementId}: ` +
                  `${result.isValid ? 'valid' : `invalid (${result.reason})`}`
            )
            .join('\n');
      return this.success(summary, { createdEdges: [], dispatchedCommands: 0, errors: [], validationResults });
   }

   protected override async runCreate(edges: EdgeInput[]): Promise<McpToolResult> {
      let beforeIds = this.modelState.index.allIds();

      const errors: string[] = [];
      const createdEdges: ElementIdentity[] = [];
      let dispatchedOperations = 0;
      // Sequential — each iteration must isolate its own creation in the post-dispatch diff.
      for (const edge of edges) {
         const { elementTypeId, routingPoints, args } = edge;
         const sourceElementId = this.aliasService.lookup(edge.sourceElementId);
         const targetElementId = this.aliasService.lookup(edge.targetElementId);

         const source = this.modelState.index.find(sourceElementId);
         if (!source) {
            errors.push(`Source element not found: ${edge.sourceElementId}`);
            continue;
         }
         const target = this.modelState.index.find(targetElementId);
         if (!target) {
            errors.push(`Target element not found: ${edge.targetElementId}`);
            continue;
         }

         const validationResult = this.validateArchiMateRelation(elementTypeId, source, target);
         if (!validationResult.isValid) {
            errors.push(validationResult.reason!);
            continue;
         }

         const operation = CreateEdgeOperation.create({ elementTypeId, sourceElementId, targetElementId, args });
         await this.actionDispatcher.dispatch(operation);
         dispatchedOperations++;

         const afterIds = this.modelState.index.allIds();
         const newIds = afterIds.filter(id => !beforeIds.includes(id));
         const newElements = newIds.map(id => this.modelState.index.find(id)).filter(element => element?.type === elementTypeId);
         const newElement = newElements[0];
         if (newElements.length > 1) {
            this.logger.warn('More than 1 new element created');
         }
         beforeIds = afterIds;

         // Operations don't surface failure directly — infer from absence of a new id of the requested type.
         if (!newElement) {
            errors.push(`Edge creation likely failed because no new element ID was found for input: ${JSON.stringify(edge)}`);
            continue;
         }

         if (routingPoints) {
            const routingPointsOperation = ChangeRoutingPointsOperation.create([
               { elementId: newElement.id, newRoutingPoints: routingPoints }
            ]);
            await this.actionDispatcher.dispatch(routingPointsOperation);
            dispatchedOperations++;
         }

         createdEdges.push(this.describeResolvedElement(newElement));
      }

      const successListStr = createdEdges.map(({ id, elementTypeId }) => `- ${elementTypeId} (#${id})`).join('\n');
      // Per-input errors are surfaced in `errors`; the call itself still succeeds — rolling back partial creates would require operation-level transactions.
      return this.success(
         `Successfully created ${createdEdges.length} edge(s) (in ${dispatchedOperations} commands):\n${successListStr}${formatNoticeList(
            'errors',
            errors
         )}`,
         { createdEdges, dispatchedCommands: dispatchedOperations, errors }
      );
   }

   /** Mirrors `RequestCheckEdgeAction`: existence check, then dynamic-hint → checker; static or unknown edgeType → valid. */
   protected override validateEdge(edge: EdgeInput): ValidationResult {
      const { elementTypeId } = edge;
      const sourceRealId = this.aliasService.lookup(edge.sourceElementId);
      const targetRealId = this.aliasService.lookup(edge.targetElementId);
      const echo: Pick<ValidationResult, 'edgeType' | 'sourceElementId' | 'targetElementId'> = {
         edgeType: elementTypeId,
         sourceElementId: edge.sourceElementId,
         targetElementId: edge.targetElementId
      };

      const source = this.modelState.index.find(sourceRealId);
      if (!source) {
         return { ...echo, isValid: false, reason: `Source element not found: ${edge.sourceElementId}` };
      }
      const target = this.modelState.index.find(targetRealId);
      if (!target) {
         return { ...echo, isValid: false, reason: `Target element not found: ${edge.targetElementId}` };
      }

      const hasDynamicHint = this.diagramConfiguration.edgeTypeHints.some(hint => hint.elementTypeId === elementTypeId && hint.dynamic);
      if (!hasDynamicHint) {
         return { ...echo, isValid: true, reason: 'no dynamic edge-type hint — static hints apply' };
      }

      const validationResult = this.validateArchiMateRelation(elementTypeId, source, target);

      return {
         ...echo,
         isValid: validationResult.isValid,
         reason: validationResult.reason
      };
   }

   protected validateArchiMateRelation(
      elementTypeId: string,
      source: GModelElement,
      target: GModelElement
   ): { isValid: boolean; reason?: string } {
      let isValid = false;

      const relationType = ARCHIMATE_RELATION_TYPE_MAP.getReverse(elementTypeId);
      const sourceType = ARCHIMATE_NODE_TYPE_MAP.getReverse(source.type);
      const targetType = ARCHIMATE_NODE_TYPE_MAP.getReverse(target.type);

      if (!RelationValidator.isValidSource(relationType, sourceType)) {
         const reason =
            `Invalid relation source. ${
               isElementType(sourceType) ? `An element of type ${sourceType}` : 'A junction'
            } cannot be assigned as a source ` + `to a relation of type ${relationType}`;
         return { isValid, reason };
      }

      if (!RelationValidator.isValidTarget(relationType, sourceType, targetType)) {
         const reason =
            `Invalid relation target. ${
               isElementType(targetType) ? `An element of type ${targetType}` : 'A junction'
            } cannot be assigned to a relation of type ${relationType} ` +
            `with ${isElementType(sourceType) ? `an element of type ${sourceType}` : 'a junction'} as source.`;
         return { isValid, reason };
      }

      return { isValid: true };
   }
}

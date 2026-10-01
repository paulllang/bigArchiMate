import { ARCHIMATE_NODE_TYPE_MAP, ARCHIMATE_RELATION_TYPE_MAP, isElementType } from '@big-archimate/protocol';
import { ChangeRoutingPointsOperation, CreateEdgeOperation, DiagramConfiguration, GModelElement } from '@eclipse-glsp/server';
import {
   CreateEdgesInput,
   CreateEdgesMcpToolHandler,
   CreateEdgesOutput,
   CreateEdgesOutputSchema,
   CreateEdgesValidationResultSchema,
   ElementIdentity,
   formatNoticeList,
   McpDiagramScopedInputSchema,
   McpToolResult,
   OperationMcpDiagramToolHandler,
   position
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';
import * as z from 'zod/v4';
import { RelationValidator } from '../../../../../language-server/util/validation/relation-validator.js';

/** Single edge-creation entry. Strict so an LLM-typoed field surfaces as a validation error instead of being silently dropped. */
const ArchimateCreateEdgeSpecSchema = z.strictObject({
    elementTypeId: z.string().describe(
      'Edge type ID (e.g., `edge:association`, `edge:composition`, `edge:assignment`). Use the `element-types` tool to discover valid IDs.'
   ),
    sourceElementId: z.string().describe('ID of the source element (must exist in the diagram)'),
    targetElementId: z.string().describe('ID of the target element (must exist in the diagram)'),
    routingPoints: z.array(position).optional().describe('Optional array of routing point coordinates that allow for a complex edge path.')
});

const ArchimateCreateEdgesInputSchema = McpDiagramScopedInputSchema.extend({
    edges: z.array(ArchimateCreateEdgeSpecSchema).min(1).describe('Array of edges to create. Must include at least one edge.'),
    dryRun: z
        .boolean()
        .optional()
        .describe(
            'When true, validate each edge against the type-hint rules without creating anything; returns per-edge `validationResults`.'
        )
});

type ArchimateCreateEdgesInput = z.infer<typeof ArchimateCreateEdgesInputSchema>;

type EdgeInput = CreateEdgesInput['edges'][number];
type ValidationResult = z.infer<typeof CreateEdgesValidationResultSchema>;

/**
 * In large part a copy of the default CreateEdgesMcpToolhandler whose main prupose
 * is to fix edge validation and add a more detailed response when validation fails.
 */
@injectable()
export class ArchiMateCreateEdgesMcpToolHandler extends OperationMcpDiagramToolHandler<ArchimateCreateEdgesInput, CreateEdgesOutput> {
   static readonly NAME = 'create-edges';
   readonly name = CreateEdgesMcpToolHandler.NAME;
   override readonly title = 'Create Diagram Edges';
   readonly description =
      'Create one or multiple new edges connecting two elements in the diagram. ' +
      'Set `dryRun: true` to validate proposed edges (per the diagram-type type-hint rules) ' +
      'without creating anything; the result then carries per-edge `validationResults`. ' +
      'Without `dryRun`, this operation modifies the diagram state and requires user approval. ' +
      'Use the `element-types` tool to discover valid edge type IDs.';
   readonly inputSchema = ArchimateCreateEdgesInputSchema;
   override readonly outputSchema = CreateEdgesOutputSchema;

   @inject(DiagramConfiguration) protected diagramConfiguration: DiagramConfiguration;

   protected async createResult({ edges, dryRun }: ArchimateCreateEdgesInput): Promise<McpToolResult> {
      if (dryRun) {
         return this.runDryRun(edges);
      }
      return this.runCreate(edges);
   }

   protected async runCreate(edges: EdgeInput[]): Promise<McpToolResult> {
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
      // Per-input errors are surfaced in `errors`;
      // the call itself still succeeds — rolling back partial creates would require operation-level transactions.
      return this.success(
         `Successfully created ${createdEdges.length} edge(s) (in ${dispatchedOperations} commands):\n${successListStr}${formatNoticeList(
            'errors',
            errors
         )}`,
         { createdEdges, dispatchedCommands: dispatchedOperations, errors }
      );
   }

   protected runDryRun(edges: EdgeInput[]): McpToolResult {
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

   /** Mirrors `RequestCheckEdgeAction`: existence check, then dynamic-hint → checker; static or unknown edgeType → valid. */
   protected validateEdge(edge: EdgeInput): ValidationResult {
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
      const isValid = false;

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

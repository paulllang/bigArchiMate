import { ApplyLabelEditOperation, CreateNodeOperation } from '@eclipse-glsp/server';
import {
   CreateNodesInput,
   CreateNodesOutputSchema,
   ElementIdentity,
   formatNoticeList,
   McpDiagramScopedInputSchema,
   McpToolResult,
   OperationMcpDiagramToolHandler,
   position
} from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';

/** Single node-creation entry. Strict so an LLM-typoed field surfaces as a validation error instead of being silently dropped. */
export const ArchiMateCreateNodeSpecSchema = z.strictObject({
   elementTypeId: z
      .string()
      .describe(
         'Element type ID (e.g., `node:business-actor`, `node:application-service`). Use the `element-types` tool to discover valid IDs.'
      ),
   position: position.describe('Position where the node should be created (absolute diagram coordinates)'),
   text: z.string().optional().describe('Label text to use in case the given element type allows for labels.')
});

export const ArchiMateCreateNodesInputSchema = McpDiagramScopedInputSchema.extend({
   nodes: z.array(ArchiMateCreateNodeSpecSchema).min(1).describe('Array of nodes to create. Must include at least one node.')
});
export type ArchiMateCreateNodesInput = z.infer<typeof ArchiMateCreateNodesInputSchema>;

/**
 * This is the virtually the same as the default `CreateNodesMcpToolHandler`. Only the optional containerId
 * and args were removed from the inputSchema, description, and the createResult method to avoid unnecessary
 * confusion for the LLM, since those aren't needed in bigArchiMate's GLSP-MCP-server.
 */
@injectable()
export class ArchiMateCreateNodesMcpToolHandler extends OperationMcpDiagramToolHandler<ArchiMateCreateNodesInput> {
   static readonly NAME = 'create-nodes';
   readonly name = ArchiMateCreateNodesMcpToolHandler.NAME;
   override readonly title = 'Create Diagram Nodes';
   readonly description =
      'Create one or multiple new nodes in the diagram at the specified positions. ' +
      'When creating new nodes absolutely consider the visual alignment with existing nodes — call ' +
      '`query-elements` (or `count-elements` or `layer-summary` for a quick overview) first to avoid overlap. ' +
      'Each node descriptor needs an `elementTypeId` (from `element-types`) and a `position`; ' +
      '`text` is optional. ' +
      'This operation modifies the diagram state and requires user approval.';
   readonly inputSchema = ArchiMateCreateNodesInputSchema;
   override readonly outputSchema = CreateNodesOutputSchema;

   protected async createResult({ nodes }: CreateNodesInput): Promise<McpToolResult> {
      let beforeIds = this.modelState.index.allIds();

      const errors: string[] = [];
      const warnings: string[] = [];
      const createdNodes: ElementIdentity[] = [];
      let dispatchedOperations = 0;
      // Sequential — each iteration must isolate its own creation in the post-dispatch diff.
      for (const node of nodes) {
         const { elementTypeId, position, text } = node;

         // Surface as `position` (matches element properties) rather than core's `location` for AI-facing API consistency.
         const operation = CreateNodeOperation.create(elementTypeId, { location: position });
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
            errors.push(`Node creation likely failed because no new element ID was found for input: ${JSON.stringify(node)}`);
            continue;
         }

         if (text) {
            const labelId = this.labelProvider.getLabel(newElement)?.id;
            if (labelId) {
               await this.actionDispatcher.dispatch(ApplyLabelEditOperation.create({ labelId, text }));
               dispatchedOperations++;
            } else {
               warnings.push(`Ignored \`text\` for '${elementTypeId}' — this element type has no editable label.`);
            }
         }

         createdNodes.push(this.describeResolvedElement(newElement));
      }

      const successListStr = createdNodes
         .map(({ id, elementTypeId, label }) => `- ${label ? `'${label}' ` : ''}${elementTypeId} (#${id})`)
         .join('\n');
      // Per-input errors / warnings are surfaced in `errors` / `warnings`; the call itself still
      // succeeds — rolling back partial creates would require operation-level transactions.
      return this.success(
         `Successfully created ${createdNodes.length} node(s) (in ${dispatchedOperations} commands):\n${successListStr}` +
            formatNoticeList('errors', errors) +
            formatNoticeList('warnings', warnings),
         { createdNodes, dispatchedCommands: dispatchedOperations, errors, warnings }
      );
   }
}

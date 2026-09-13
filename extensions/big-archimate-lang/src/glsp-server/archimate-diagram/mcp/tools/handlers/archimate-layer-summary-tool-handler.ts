import { ARCHIMATE_NODE_TYPE_MAP, getLayer, isElementType, isJunctionType, layerTypes } from '@big-archimate/protocol';
import { AbstractMcpDiagramToolHandler, McpDiagramScopedInputSchema, McpToolResult } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';

export const ArchiMateLayerSummaryInputSchema = McpDiagramScopedInputSchema;
export type ArchiMateLayerSummaryInput = z.infer<typeof ArchiMateLayerSummaryInputSchema>;

export const ArchiMateLayerSummaryOutputSchema = z.object({
   total: z.number().int().describe('Total nodes (= ArchiMate elements and junctions) in the diagram.'),
   countsByLayer: z.record(z.string(), z.number().int()).describe('Nodes (= ArchiMate elements and junctions) count per ArchiMate layer.')
});

/**
 * Counts nodes (= ArchiMate elements and junctions) grouped by the standard ArchiMate layer (Business, Application,
 * Technology, Motivation, Strategy, ImplementationAndMigration, Other). Useful as a quick
 * "is this diagram balanced across layers" check before loading the full diagram-model.
 *
 * Relations and the graph itself are not included.
 */
@injectable()
export class ArchiMateLayerSummaryMcpToolHandler extends AbstractMcpDiagramToolHandler<ArchiMateLayerSummaryInput> {
   static readonly NAME = 'archimate-layer-summary';
   readonly name = ArchiMateLayerSummaryMcpToolHandler.NAME;
   override readonly title = 'ArchiMate Layer Summary';
   readonly description =
      'Count nodes (= ArchiMate elements and junctions) in the diagram grouped by ArchiMatelayer ' +
      '(Business, Application, Technology, Motivation, Strategy, ImplementationAndMigration, Other). ' +
      'Cheap layer-balance check before fetching the full diagram-model. ' +
      'Relations and the graph itself are not included.';
   readonly inputSchema = ArchiMateLayerSummaryInputSchema;
   override readonly outputSchema = ArchiMateLayerSummaryOutputSchema;

   protected async createResult(_params: ArchiMateLayerSummaryInput): Promise<McpToolResult> {
      const countsByLayer: Record<string, number> = Object.fromEntries(layerTypes.map(layer => [layer, 0]));
      let total = 0;
      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         if (!element) {
            continue;
         }
         const concept = ARCHIMATE_NODE_TYPE_MAP.getReverse(element.type);
         if (!concept || !(isElementType(concept) || isJunctionType(concept))) {
            continue;
         }
         const layer = getLayer(concept);
         countsByLayer[layer] = (countsByLayer[layer] ?? 0) + 1;
         total += 1;
      }
      return this.success(this.renderMarkdown(total, countsByLayer), { total, countsByLayer });
   }

   protected renderMarkdown(total: number, countsByLayer: Record<string, number>): string {
      const rows = layerTypes.map(layer => `- ${layer}: ${countsByLayer[layer] ?? 0}`).join('\n');
      return `Total ArchiMate element${total === 1 ? '' : 's'}: ${total}\n\nBy layer:\n${rows}`;
   }
}

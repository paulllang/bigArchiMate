import { ARCHIMATE_CONCEPT_TYPE_MAP } from '@big-archimate/protocol';
import { DefaultTypes } from '@eclipse-glsp/server';
import { CountElementsInput, CountElementsMcpToolHandler, McpToolResult } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';

const CountElementsOutputSchema = z.object({
   total: z.number().describe('Total element count across the diagram (graph itself as root included).'),
   countsByType: z.record(z.string(), z.number().int()).describe('Element count grouped by element type.')
});

/**
 * Counts elements in the diagram, grouped by type. Cheap alternative to dumping the full
 * `diagram-model` resource when the agent only needs to know "how big is this" or "do any
 * elements of type X exist".
 */
@injectable()
export class ArchiMateCountElementsMcpToolHandler extends CountElementsMcpToolHandler {
   override readonly outputSchema = CountElementsOutputSchema;

   protected override async createResult(_params: CountElementsInput): Promise<McpToolResult> {
      const countsByType: Record<string, number> = {};
      let total = 0;
      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         const isArchiMateConcept = ARCHIMATE_CONCEPT_TYPE_MAP.getReverse(element.type);
         if (!isArchiMateConcept && element.type !== DefaultTypes.GRAPH) {
            continue;
         }
         countsByType[element.type] = (countsByType[element.type] ?? 0) + 1;
         total += 1;
      }
      return this.success(this.renderMarkdown(total, countsByType), { total, countsByType });
   }
}

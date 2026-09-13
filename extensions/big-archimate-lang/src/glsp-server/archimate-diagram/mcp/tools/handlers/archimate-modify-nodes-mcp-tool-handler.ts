import { elementId, McpDiagramScopedInputSchema, ModifyNodesMcpToolHandler, position } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';

const ArchiMateNodeSizeSchema = z.strictObject({
   width: z.number().positive().describe('Width of the node in diagram space (must be > 0).'),
   height: z.number().positive().describe('Height of the node in diagram space (must be > 0).')
});

/** Single node-modification entry. Strict so an LLM-typoed field surfaces as a validation error instead of being silently dropped. */
const ArchiMateModifyNodeSpecSchema = z.strictObject({
   elementId,
   position: position
      .optional()
      .describe(
         'Position where the node should be moved to' +
            'Matches the `position` reported by `query-elements` (inspect mode) and `diagram-model`.'
      ),
   size: ArchiMateNodeSizeSchema.optional().describe('New size of the node.'),
   text: z.string().optional().describe("Label text to use instead (given that the element's type allows for labels).")
});

const ArchiMateModifyNodesInputSchema = McpDiagramScopedInputSchema.extend({
   nodes: z
      .array(ArchiMateModifyNodeSpecSchema)
      .min(1)
      .describe('Array of node changes — each entry needs `elementId` plus the fields to update. Must include at least one change.')
});

/**
 * The sole purpose of this class it to align the wording of the input schema and the descirption.
 */
@injectable()
export class ArchiMateModifyNodesMcpToolHandler extends ModifyNodesMcpToolHandler {
   override readonly inputSchema = ArchiMateModifyNodesInputSchema;
   override readonly description =
      'Modify one or more existing nodes by changing their position, size, and/or label text. ' +
      'When modifying position or size, absolutely consider the visual alignment with other nodes — ' +
      'use `query-elements` (inspect mode) first to understand the layout. ' +
      'Each change entry can include any combination of `position`, `size`, and `text`; omitted fields keep their current value. ' +
      'This operation modifies the diagram state and requires user approval. ' +
      'Only nodes can be modified in BigArchiMate; for edges, delete and re-create them instead.';
}

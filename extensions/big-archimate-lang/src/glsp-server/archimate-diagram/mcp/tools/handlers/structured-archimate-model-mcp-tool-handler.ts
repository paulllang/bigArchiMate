import { layerTypes } from '@big-archimate/protocol';
import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import {
   AbstractMcpDiagramToolHandler,
   DiagramModelInput,
   DiagramModelInputSchema,
   McpModelSerializer,
   McpToolResult,
   NodeSizeSchema,
   position
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';
import * as z from 'zod/v4';

const ArchiMateNodeBoundsSchema = z.object({
   left: z.number().positive().describe('Left boundary coordinate in diagram space'),
   right: z.number().positive().describe('Right boundary coordinate in diagram space'),
   top: z.number().positive().describe('Top boundary coordinate in diagram space'),
   bottom: z.number().positive().describe('Bottom boundary coordinate in diagram space')
});

const ArchiMateNodeSchema = z.object({
   id: z.string().describe('Aliased node id.'),
   elementTypeId: z.string().describe(
      'Node type ID (e.g., `node:business-actor`, `node:application-service`). Use the `element-types` tool to discover valid IDs.'
   ),
   label: z.string().optional().describe('Primary label text, when the element has one.'),
   position: position,
   size: NodeSizeSchema,
   bounds: ArchiMateNodeBoundsSchema
});
export type ArchiMateNodeOutputSchema = z.infer<typeof ArchiMateNodeSchema>;

const ArchiMateEdgeSchema = z.object({
   id: z.string().describe('Aliased edge id.'),
   elementTypeId: z.string().describe(
   'Edge type ID (e.g., `edge:association`, `edge:composition`, `edge:assignment`). Use the `element-types` tool to discover valid IDs.'
   ),
   sourceElementId: z.string().describe('ID of the source element (must exist in the diagram)'),
   targetElementId: z.string().describe('ID of the target element (must exist in the diagram)')
});
export type ArchiMateEdgeOutputSchema = z.infer<typeof ArchiMateEdgeSchema>;

export const ArchiMateLayerOutputSchema = z.object({
  name: z.enum(layerTypes).describe('Name of the ArchiMate layer.'),
  nodes: z
    .array(ArchiMateNodeSchema)
    .optional()
    .describe(
      'All nodes belonging to this ArchiMate layer. Junctions and grouping nodes are assigned to the custom "Other" layer, ' +
      'as they do not belong to a specific layer according to the ArchiMate standard.'
    ),
  edges: z
    .array(ArchiMateEdgeSchema)
    .optional()
    .describe(
      'Edges between nodes within the same ArchiMate layer. ' +
      'Edges connecting elements from different ArchiMate layers are assigned to the custom "Other" layer. ' +
      'Although edges are layerless accodring to the ArchiMate standard, ' +
      'this approach allows the LLM to read the model layer by layer like an enterprise architect.'
    )
});

export type ArchiMateLayerOutputSchema = z.infer<typeof ArchiMateLayerOutputSchema>;

export const ArchiMateDiagramModelOutputSchema = z.object({
  sessionId: z.string().describe('GLSP client session ID for the open diagram.'),
  layers: z
    .array(ArchiMateLayerOutputSchema)
    .optional()
    .describe('List of all active ArchiMate layers in the diagram, containing their respective nodes and edges.')
});
/**
 * Mcp tool handler that returns the serialized diagram as JSON in the
 * structuredContent property and short summary sentence in the content property of the response.
 */
@injectable()
export class StructuredArchiMateModelMcpToolHandler extends AbstractMcpDiagramToolHandler<DiagramModelInput> {
   static readonly NAME = 'diagram-model';
   readonly name = StructuredArchiMateModelMcpToolHandler.NAME;
   override readonly title = 'Diagram Model Structure';
   override readonly description =
      'Get the complete model for a session as a JSON in structuredContent. ' +
      'Includes all nodes, edges, and their relevant properties. ' +
      'For large diagrams, prefer `query-elements` (filtered listing) or `count-elements` (size summary) ' +
      'before falling back to this full dump.';
   readonly inputSchema = DiagramModelInputSchema;
   override readonly outputSchema = ArchiMateDiagramModelOutputSchema;

   @inject(McpModelSerializer) protected serializer: McpModelSerializer;

   protected createResult({ sessionId }: DiagramModelInput): McpToolResult {
      const root = this.modelState.root;
      const structured = this.serializer.serializeStructured(root);
      let count = 0;

      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         if (!element || element instanceof GCompartment || element instanceof GLabel) {
            continue;
         }
         count++;
      }

      return this.success(this.summarizeStructuredModel(root, count), { sessionId, ...structured });
   }

   // Summary line when isStructured is enabled.
   // It will be placed in the content property of the response,
   // whereas the serialized diagram will be in structuredContent.
   protected summarizeStructuredModel(root: GModelElement, elementCount: number): string {
      return `Diagram '${this.aliasService.alias(root.id)}' (${root.type}) contains ${elementCount} element${
         elementCount === 1 ? '' : 's'
      }. Full structure in structuredContent.`;
   }
}

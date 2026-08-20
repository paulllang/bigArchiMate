import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import {
   AbstractMcpDiagramToolHandler,
   DiagramModelInput,
   DiagramModelInputSchema,
   McpModelSerializer,
   McpToolResult
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';

/**
 * Mcp tool handler that returns the serialized diagram either as  JSON or
 * Markdown with a short summary sentence in the content-property of the response.
 */
@injectable()
export class UnstructuredArchiMateModelMcpToolHandler extends AbstractMcpDiagramToolHandler<DiagramModelInput> {
   static readonly NAME = 'archimate-diagram-model';
   readonly name = UnstructuredArchiMateModelMcpToolHandler.NAME;
   override readonly title = 'ArchiMate Diagram Model Structure';
   override readonly description =
      'Get the complete ArchiMate diagram for a session. ' +
      'Includes all elements, relationships, junctions, and their relevant properties. ' +
      'For large diagrams, prefer `query-elements` (filtered listing) or `count-elements` (size summary) ' +
      'before falling back to this full dump.';
   readonly inputSchema = DiagramModelInputSchema;

   @inject(McpModelSerializer) protected serializer: McpModelSerializer;

   protected createResult({ sessionId }: DiagramModelInput): McpToolResult {
      const root = this.modelState.root;
      let count = 0;

      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         if (!element || element instanceof GCompartment || element instanceof GLabel) {
            continue;
         }
         count++;
      }

      const unstructured = this.serializer.serialize(root);
      return this.success(this.summarizeModel(root, count, sessionId) + '\n\n' + unstructured);
   }

   // Summary line when isStructured is disabled.
   // It will be placed before the serialized diagram together
   // in the content property of the response.
   protected summarizeModel(root: GModelElement, elementCount: number, sessionId: string): string {
      return `Diagram '${this.aliasService.alias(root.id)}' (${root.type}) contains ${elementCount} concept${
         elementCount === 1 ? '' : 's'
      } for sessionId '${sessionId}'.`;
   }
}

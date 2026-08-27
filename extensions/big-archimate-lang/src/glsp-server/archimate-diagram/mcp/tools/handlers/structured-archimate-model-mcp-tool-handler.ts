import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import {
   AbstractMcpDiagramToolHandler,
   DiagramModelInput,
   DiagramModelInputSchema,
   McpModelSerializer,
   McpToolResult
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';
import * as z from 'zod/v4';

// base geometry output schemas

export const PositionSchema = z.object({
   x: z.number(),
   y: z.number()
});

export const SizeSchema = z.object({
   width: z.number().positive(),
   height: z.number().positive()
});

export const BoundsSchema = z.object({
   left: z.number().positive(),
   right: z.number().positive(),
   top: z.number().positive(),
   bottom: z.number().positive()
});

// concept and graph output schemas

export const ElementNodeSchema = z.object({
   id: z.string(),
   type: z.string(),
   element: z.string(),
   label: z.string(),
   position: PositionSchema,
   size: SizeSchema,
   bounds: BoundsSchema
});

export const RelationEdgeSchema = z.object({
   id: z.string(),
   type: z.string(),
   relation: z.string(),
   sourceId: z.string(),
   targetId: z.string()
});

export const JunctionNodeSchema = z.object({
   id: z.string(),
   type: z.string(),
   junction: z.string(),
   position: PositionSchema,
   size: SizeSchema,
   bounds: BoundsSchema
});

export const GraphItemSchema = z.object({
   id: z.string(),
   type: z.string()
});

// layer output schemas

export const StandardLayerSchema = z.object({
   elements: z.array(ElementNodeSchema).optional(),
   relations: z.array(RelationEdgeSchema).optional()
});

export const OtherLayerSchema = z.object({
   junctions: z.array(JunctionNodeSchema).optional(),
   groupings: z.array(ElementNodeSchema).optional(),
   'crosslayer relations': z.array(RelationEdgeSchema).optional(),
   graph: z.array(GraphItemSchema).optional()
});

// main output schema

const ArchiMateDiagramModelOutputSchema = z.object({
   sessionId: z.string(),
   Application: StandardLayerSchema.optional(),
   Business: StandardLayerSchema.optional(),
   ImplementationAndMigration: StandardLayerSchema.optional(),
   Motivation: StandardLayerSchema.optional(),
   Strategy: StandardLayerSchema.optional(),
   Technology: StandardLayerSchema.optional(),
   Other: OtherLayerSchema
});

/**
 * Mcp tool handler that returns the serialized diagram as JSON in the
 * structuredContent property and short summary sentence in the content property of the response.
 */
@injectable()
export class StructuredArchiMateModelMcpToolHandler extends AbstractMcpDiagramToolHandler<DiagramModelInput> {
   static readonly NAME = 'archimate-diagram-model';
   readonly name = StructuredArchiMateModelMcpToolHandler.NAME;
   override readonly title = 'ArchiMate Diagram Model Structure';
   override readonly description =
      'Get the complete ArchiMate diagram for a session as a JSON in structuredContent. ' +
      'Includes all elements, relationships, junctions, and their relevant properties. ' +
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
      return `Diagram '${this.aliasService.alias(root.id)}' (${root.type}) contains ${elementCount} concept${
         elementCount === 1 ? '' : 's'
      }. Full structure in structuredContent.`;
   }
}

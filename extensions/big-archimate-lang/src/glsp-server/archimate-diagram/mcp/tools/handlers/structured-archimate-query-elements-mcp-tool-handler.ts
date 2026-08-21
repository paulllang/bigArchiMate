import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import {
   AbstractMcpDiagramToolHandler,
   McpElementsNotFoundError,
   McpModelSerializer,
   McpToolResult,
   QueryElementMatchSchema,
   QueryElementsInput,
   QueryElementsInputSchema
} from '@eclipse-glsp/server-mcp';
import { inject, injectable } from 'inversify';
import * as z from 'zod/v4';
import { OtherLayerSchema, StandardLayerSchema } from './structured-archimate-model-mcp-tool-handler.js';

const InspectModeOutputSchema = z.object({
   Application: StandardLayerSchema.optional(),
   Business: StandardLayerSchema.optional(),
   ImplementationAndMigration: StandardLayerSchema.optional(),
   Motivation: StandardLayerSchema.optional(),
   Strategy: StandardLayerSchema.optional(),
   Technology: StandardLayerSchema.optional(),
   Other: OtherLayerSchema.optional()
});

const QueryArchiMateConceptsOutputSchema = z.object({
   mode: z.enum(['list', 'inspect']).describe('Echoes which mode the call ran in.'),
   matches: z.array(QueryElementMatchSchema).optional().describe('Present in `list` mode: slim id/type/label entries.'),
   concepts: InspectModeOutputSchema.optional().describe('Present in `inspect` mode: rich per-concept detail.'),
   truncated: z.boolean().optional().describe('Present in `list` mode: true when more elements matched than `limit`.'),
   expandedFromContainers: z
      .array(z.string())
      .optional()
      .describe(
         'Present in `inspect` mode when one or more requested ids referred to containers — lists those container ids. ' +
            'The `elements` array then includes the container plus its descendants.'
      )
});

/** Two-mode element query — list/filter or inspect-by-id, discriminated by `elementIds` presence. */
@injectable()
export class StructuredArchiMateQueryElementsMcpToolHandler extends AbstractMcpDiagramToolHandler<QueryElementsInput> {
   static readonly NAME = 'query-archimate-elements';
   readonly name = StructuredArchiMateQueryElementsMcpToolHandler.NAME;
   override readonly title = 'Query ArchiMate Diagram Elements';
   readonly description =
      'Find or inspect elements in the session diagram. Pass `elementIds` to inspect specific ' +
      'elements in detail (rich per-element data). Pass `types` and/or `labelMatch` to search by ' +
      'filter (slim id/type/label summaries with truncation). Useful as a precursor to the ' +
      'create/modify/delete tools, and a cheaper alternative to `diagram-model` on large diagrams.';
   readonly inputSchema = QueryElementsInputSchema;
   override readonly outputSchema = QueryArchiMateConceptsOutputSchema;

   @inject(McpModelSerializer) protected serializer: McpModelSerializer;

   /** List-mode result cap when the call doesn't override `limit`. Override via subclass. */
   protected readonly defaultLimit: number = 100;

   protected async createResult(params: QueryElementsInput): Promise<McpToolResult> {
      return params.elementIds && params.elementIds.length > 0 ? this.inspect(params.elementIds) : this.list(params);
   }

   protected inspect(inputIds: string[]): McpToolResult {
      const { realIds, missingIds } = this.resolveIds(inputIds);
      if (missingIds.length > 0) {
         throw new McpElementsNotFoundError(missingIds);
      }
      const elements: GModelElement[] = realIds.map(id => this.modelState.index.get(id)!);
      const expandedFromContainers = this.getExpandedContainers(elements);

      return this.success(this.summarizeInspect(elements, expandedFromContainers), {
         mode: 'inspect',
         concepts: this.serializer.serializeStructuredArray(elements),
         expandedFromContainers: expandedFromContainers.length > 0 ? expandedFromContainers : undefined
      });
   }

   protected summarizeInspect(elements: GModelElement[], expandedFromContainers: string[]): string {
      const lines = elements.map(element => `- ${this.aliasService.alias(element.id)} (${element.type})`);
      const expansionNote =
         expandedFromContainers.length > 0 ? `\nContainer(s) ${expandedFromContainers.join(', ')} expanded to include descendants.` : '';
      return `Inspected ${elements.length} element(s); full data in structuredContent.\n${lines.join('\n')}${expansionNote}`;
   }

   protected getExpandedContainers(elements: GModelElement[]): string[] {
      const expandedContainers: string[] = [];
      elements.forEach(element => {
         for (const child of element.children) {
            if (!(child instanceof GCompartment || child instanceof GLabel)) {
               expandedContainers.push(element.id);
               break; // Stops checking remaining children immediately
            }
         }
      });
      return expandedContainers.map(id => this.aliasService.alias(id));
   }

   protected list({ types, labelMatch, limit }: QueryElementsInput): McpToolResult {
      const cap = limit ?? this.defaultLimit;
      const typeFilter = types && types.length > 0 ? new Set(types) : undefined;
      const needle = labelMatch?.toLowerCase();

      const matches: { id: string; type: string; label?: string }[] = [];
      let truncated = false;
      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         if (!element || element instanceof GCompartment || element instanceof GLabel) {
            continue;
         }
         if (typeFilter && !typeFilter.has(element.type)) {
            continue;
         }
         const label = this.labelProvider.getLabel(element)?.text;
         if (needle !== undefined && !label?.toLowerCase().includes(needle)) {
            continue;
         }
         if (matches.length >= cap) {
            truncated = true;
            break;
         }
         matches.push({ id: this.aliasService.alias(element.id), type: element.type, ...(label !== undefined ? { label } : {}) });
      }

      const summary = matches.length === 0 ? 'no concepts matched the query.' : this.renderMarkdown(matches, truncated);
      return this.success(summary, { mode: 'list', matches, truncated });
   }

   protected renderMarkdown(matches: { id: string; type: string; label?: string }[], truncated: boolean): string {
      const rows = matches.map(match => `- ${match.id} (${match.type})${match.label ? ` — "${match.label}"` : ''}`).join('\n');
      const tail = truncated ? '\n\n_(truncated — increase `limit` or refine filters to see more)_' : '';
      return `Query matched ${matches.length} concept${matches.length === 1 ? '' : 's'}:\n${rows}${tail}`;
   }
}

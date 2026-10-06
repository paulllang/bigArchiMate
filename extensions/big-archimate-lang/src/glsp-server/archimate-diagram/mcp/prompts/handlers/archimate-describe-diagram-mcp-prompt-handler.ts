import {
    CountElementsMcpToolHandler,
    DescribeDiagramArgs,
    DescribeDiagramMcpPromptHandler,
    DiagramModelMcpToolHandler,
    ElementTypesMcpToolHandler,
    McpPromptResult,
    QueryElementsMcpToolHandler,
    resolveActiveSessionId,
    SetSelectionMcpToolHandler,
    SetViewMcpToolHandler
} from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import { ArchiMateLayerSummaryMcpToolHandler } from '../../tools/handlers/archimate-layer-summary-tool-handler.js';

/**
 * Prompt template that instructs the agent to produce a structured description of a diagram.
 * Pre-baked starting point invokable from the MCP-client UI; the agent then orchestrates the
 * necessary tool calls on its own.
 *
 * Server-scope on purpose — the prompt itself has no per-session state, so we avoid forcing
 * the user to type a sessionId in the common single-diagram case.
 */
@injectable()
export class ArchiMateDescribeDiagramMcpPromptHandler extends DescribeDiagramMcpPromptHandler {

    override referencedToolNames(): string[] {
        return [
            CountElementsMcpToolHandler.NAME,
            ArchiMateLayerSummaryMcpToolHandler.NAME,
            ElementTypesMcpToolHandler.NAME,
            DiagramModelMcpToolHandler.NAME,
            QueryElementsMcpToolHandler.NAME,
            SetSelectionMcpToolHandler.NAME,
            SetViewMcpToolHandler.NAME
        ];
    }

    protected override createResult(args: DescribeDiagramArgs): McpPromptResult {
        const sessionId = resolveActiveSessionId(this.clientSessionManager, args.sessionId);
        const text =
            `Describe the diagram for session \`${sessionId}\`. Include:\n\n` +
            `1. **Overview** — diagram type and total element count (use \`${CountElementsMcpToolHandler.NAME}\`).\n` +
            '2. **Element-type breakdown** — what kinds of elements are present and how many of each ' +
            `(use \`${ElementTypesMcpToolHandler.NAME}\` and \`${CountElementsMcpToolHandler.NAME}\`).\n` +
            `3. **Structure** — use \`${ArchiMateLayerSummaryMcpToolHandler.NAME}\` to determine whether the model ` +
            'focuses on a specific layer or encompasses multiple layers, ' +
            `then load the model with \`${DiagramModelMcpToolHandler.NAME}\` and summarize the hierarchy and major connections.\n` +
            '4. **Notable elements** — call out anything that stands out (unconnected nodes, deeply ' +
            `nested groups, missing labels). Use \`${QueryElementsMcpToolHandler.NAME}\` to locate specific cases.\n\n` +
            'Keep the description concise and skim-friendly. ' +
            'When mentioning an element, prefer its label or type, with the alias appended in parens — e.g. ' +
            '"the \'Instagram\' ApplicationComponent (#7)" or "the \'Influencer\' BusinessActor (#9)" — never the bare alias alone, ' +
            'since aliases mean nothing to the user. ' +
            `Use \`${SetSelectionMcpToolHandler.NAME}\` or \`${SetViewMcpToolHandler.NAME} → 'center-on-elements'\` ` +
            'to draw the user\'s attention.';
        return { messages: [{ role: 'user', content: { type: 'text', text } }] };
    }
}

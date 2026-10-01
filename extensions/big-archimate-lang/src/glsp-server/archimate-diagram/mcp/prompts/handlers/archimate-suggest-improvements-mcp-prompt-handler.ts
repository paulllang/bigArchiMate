import {
    DiagramModelMcpToolHandler,
    McpPromptResult,
    QueryElementsMcpToolHandler,
    resolveActiveSessionId,
    SetSelectionMcpToolHandler,
    SuggestImprovementsArgs,
    SuggestImprovementsMcpPromptHandler
} from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

/**
 * Prompt template that asks the agent to review the diagram and propose concrete improvements
 * (structural smells, missing labels, etc.). The agent orchestrates the
 * tool calls; this prompt only frames the task.
 *
 * Server-scope on purpose — the prompt itself has no per-session state, so we avoid forcing
 * the user to type a sessionId in the common single-diagram case.
 */
@injectable()
export class ArchiMateSuggestImprovementsMcpPromptHandler extends SuggestImprovementsMcpPromptHandler {
    override readonly description =
        'Review an open diagram and propose concrete improvements grouped by severity ' +
        '(must-fix vs. nice-to-have). The agent checks connectivity, looks for unclear labels, ' +
        'and flags structural inconsistencies, then names the specific element ids for each suggestion so the user ' +
        'can act on them. Read-only by intent — the prompt instructs the agent not to modify the diagram, only propose. ' +
        '`sessionId` is optional — defaults to the only open session.';

    protected override createResult(args: SuggestImprovementsArgs): McpPromptResult {
        const sessionId = resolveActiveSessionId(this.clientSessionManager, args.sessionId);
        const text =
            `Review the diagram for session \`${sessionId}\` and propose concrete improvements. Focus on:\n\n` +
            `1. **Connectivity** — load the model (\`${DiagramModelMcpToolHandler.NAME}\`) and flag unconnected ` +
            'nodes or orphaned subgraphs.\n' +
            `3. **Labelling** — use \`${QueryElementsMcpToolHandler.NAME}\` to find nodes that lack a meaningful label\n` +
            '4. **Structure** — call out elements whose type or placement looks inconsistent with ' +
            'the rest of the diagram.\n\n' +
            'Group findings by severity (must-fix vs. nice-to-have). ' +
            'When naming elements, prefer their label or type with the alias in parens — e.g. ' +
            '"the \'Instagram\' ApplicationComponent (#7)" or "the \'Influencer\' BusinessActor (#9)" — ' +
            'never the bare alias alone, since aliases mean nothing to the user. ' +
            `Point at each suggestion via \`${SetSelectionMcpToolHandler.NAME}\` so the user can navigate. ` +
            'Do not modify the diagram — only propose.';
        return { messages: [{ role: 'user', content: { type: 'text', text } }] };
    }
}

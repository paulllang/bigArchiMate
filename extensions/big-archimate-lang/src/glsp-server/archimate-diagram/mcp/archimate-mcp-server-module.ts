import {
   DescribeDiagramMcpPromptHandler,
   ElementTypesMcpToolHandler,
   McpHandlerMultiBinding,
   McpPromptHandler,
   McpToolHandler,
   SuggestImprovementsMcpPromptHandler
} from '@eclipse-glsp/server-mcp';
import { NodeMcpServerModule } from '@eclipse-glsp/server-mcp/node.js';
import { ArchiMateDescribeDiagramMcpPromptHandler } from './prompts/handlers/archimate-describe-diagram-mcp-prompt-handler.js';
import { ArchiMateSuggestImprovementsMcpPromptHandler } from './prompts/handlers/archimate-suggest-improvements-mcp-prompt-handler.js';
import { ArchimateElementTypesMcpToolHandler } from './tools/handlers/archimate-element-types-mcp-tool-handler.js';

/**
 * ArchiMate-specific server-scope MCP module.
 */
export class ArchiMateNodeMcpServerModule extends NodeMcpServerModule {
   protected override configureToolHandlers(binding: McpHandlerMultiBinding<McpToolHandler>): void {
      super.configureToolHandlers(binding);
      binding.rebind(ElementTypesMcpToolHandler, ArchimateElementTypesMcpToolHandler);
   }

   protected override configurePromptHandlers(binding: McpHandlerMultiBinding<McpPromptHandler>): void {
      super.configurePromptHandlers(binding);
      binding.rebind(DescribeDiagramMcpPromptHandler, ArchiMateDescribeDiagramMcpPromptHandler);
      binding.rebind(SuggestImprovementsMcpPromptHandler, ArchiMateSuggestImprovementsMcpPromptHandler);
   }
}

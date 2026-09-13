import { ElementTypesMcpToolHandler, McpHandlerMultiBinding, McpToolHandler } from '@eclipse-glsp/server-mcp';
import { NodeMcpServerModule } from '@eclipse-glsp/server-mcp/node.js';
import { ArchimateElementTypesMcpToolHandler } from './tools/handlers/archimate-element-types-mcp-tool-handler.js';
/**
 * ArchiMate-specific server-scope MCP module.
 */
export class ArchiMateNodeMcpServerModule extends NodeMcpServerModule {
   protected override configureToolHandlers(binding: McpHandlerMultiBinding<McpToolHandler>): void {
      super.configureToolHandlers(binding);
      binding.rebind(ElementTypesMcpToolHandler, ArchimateElementTypesMcpToolHandler);
   }
}

import { ElementTypesMcpToolHandler, McpHandlerMultiBinding, McpToolHandler } from '@eclipse-glsp/server-mcp';
import { NodeMcpServerModule } from '@eclipse-glsp/server-mcp/node.js';
import { ArchimateElementTypesMcpToolHandler } from './tools/handlers/archimate-element-types-mcp-tool-handler.js';
/**
 * ArchiMate-specific diagram-scope MCP module. Inherits the default MCP tool set
 * (session-info, query-elements, diagram-model, create-nodes, ...) and binds
 * ArchiMate-aware providers for element-type enumeration, label lookup, and
 * model serialization. Adds the archimate-layer-summary tool.
 */
export class ArchiMateNodeMcpServerModule extends NodeMcpServerModule {
   protected override configureToolHandlers(binding: McpHandlerMultiBinding<McpToolHandler>): void {
      super.configureToolHandlers(binding);
      binding.rebind(ElementTypesMcpToolHandler, ArchimateElementTypesMcpToolHandler);
   }
}

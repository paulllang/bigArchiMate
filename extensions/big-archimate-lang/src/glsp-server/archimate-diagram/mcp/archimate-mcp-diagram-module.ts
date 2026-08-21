import { BindingTarget, InstanceMultiBinding } from '@eclipse-glsp/server';
import {
   DefaultMcpDiagramModule,
   DiagramModelMcpToolHandler,
   ElementTypesProvider,
   McpDiagramToolHandlerConstructor,
   McpLabelProvider,
   McpModelSerializer,
   QueryElementsMcpToolHandler
} from '@eclipse-glsp/server-mcp';
import { ArchiMateElementTypesProvider } from './archimate-element-types-provider.js';
import { ArchiMateLayerSummaryMcpToolHandler } from './archimate-layer-summary-tool-handler.js';
import { ArchiMateMcpLabelProvider } from './archimate-mcp-label-provider.js';
import { ArchiMateMcpModelSerializer } from './archimate-mcp-model-serializer.js';
import { StructuredArchiMateModelMcpToolHandler } from './tools/handlers/structured-archimate-model-mcp-tool-handler.js';
import { StructuredArchiMateQueryElementsMcpToolHandler } from './tools/handlers/structured-archimate-query-elements-mcp-tool-handler.js';
import { UnstructuredArchiMateModelMcpToolHandler } from './tools/handlers/unstructured-archimate-model-mcp-tool-handler.js';
import { UnstructuredArchiMateQueryElementsMcpToolHandler } from './tools/handlers/unstructured-archimate-query-elements-mcp-tool-handler.js';
/**
 * ArchiMate-specific diagram-scope MCP module. Inherits the default MCP tool set
 * (session-info, query-elements, diagram-model, create-nodes, ...) and binds
 * ArchiMate-aware providers for element-type enumeration, label lookup, and
 * model serialization. Adds the archimate-layer-summary tool.
 */
export class ArchiMateMcpDiagramModule extends DefaultMcpDiagramModule {
   protected override bindElementTypesProvider(): BindingTarget<ElementTypesProvider> {
      return ArchiMateElementTypesProvider;
   }

   protected override bindLabelProvider(): BindingTarget<McpLabelProvider> {
      return ArchiMateMcpLabelProvider;
   }

   protected override bindModelSerializer(): BindingTarget<McpModelSerializer> {
      return ArchiMateMcpModelSerializer;
   }

   protected override configureToolHandlers(binding: InstanceMultiBinding<McpDiagramToolHandlerConstructor>): void {
      super.configureToolHandlers(binding);
      binding.add(ArchiMateLayerSummaryMcpToolHandler);

      /**
       * @experimental
       * This is a makeshift solution. If later evalutation shows both structured and unstructured approachs
       * have their reight to exist (e.g., one approach is more token efficient, but generates worse diagrams),
       * the user will be able to choose his/her preferred option in the app's settings.
       */
      const isStructured = true;

      if (isStructured) {
         binding.rebind(DiagramModelMcpToolHandler, StructuredArchiMateModelMcpToolHandler);
         binding.rebind(QueryElementsMcpToolHandler, StructuredArchiMateQueryElementsMcpToolHandler);
      } else {
         binding.rebind(DiagramModelMcpToolHandler, UnstructuredArchiMateModelMcpToolHandler);
         binding.rebind(QueryElementsMcpToolHandler, UnstructuredArchiMateQueryElementsMcpToolHandler);
      }
   }
}

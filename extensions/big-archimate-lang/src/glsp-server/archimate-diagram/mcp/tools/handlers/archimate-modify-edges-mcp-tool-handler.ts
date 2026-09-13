import { ModifyEdgesMcpToolHandler } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

/**
 * The sole purpose of this class is to disable the {@link ModifyEdgesMcpToolHandler} for LLMs.
 * As of 12.9.2026, visually modifying edges in the "Diagram Editor" is not supported in BigArchiMate.
 * Users can modify edges in the "Code Editor" though, but that leads to inconsistencies between the
 * "Diagram Editor", "Form View" and "Code Editor". Until this is resolved, it is best to just
 * disable the {@link ModifyEdgesMcpToolHandler} for LLMs.
 */
@injectable()
export class ArchiMateModifyEdgesMcpToolHandler extends ModifyEdgesMcpToolHandler {
   /** Keep the tool out of the MCP catalog */
   override isSupportedByDiagramType(): boolean {
      return false;
   }

   /** Skip session registration */
   override canRegister(): boolean {
      return false;
   }
}

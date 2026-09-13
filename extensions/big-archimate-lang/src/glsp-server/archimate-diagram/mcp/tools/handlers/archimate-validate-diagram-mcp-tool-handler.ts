import { ValidateDiagramMcpToolHandler } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

/**
 * The default {@link ValidateDiagramMcpToolHandler} uses GLSP's {@link ModelValidator} to validate each node and
 * return a list of {@link Marker}s visually indicating any issues of each node.
 * However, in BigArchiMate there is no implementation of a {@link ModelValidator} and,
 * thus, no {@link Marker}s appear in the diagram.
 * Rather, BigArchiMate disallows creating invalid diagrams via GLSP in the first place.
 * If an invalid diagram is created through either the language server or the form model server,
 * the GLSP diagram is set to read-only, making a validator ultimately redundant.
 * Consequently, the sole purpose of this class is to disable the {@link ValidateDiagramMcpToolHandler} for LLMs.
 *
 * In case the validation approach changes in the future in BigArchiMate, feel free to adapt this class accordingly.
 */
@injectable()
export class ArchiMateValidateDiagramMcpToolHandler extends ValidateDiagramMcpToolHandler {
   /** Keep the tool out of the MCP catalog */
   override isSupportedByDiagramType(): boolean {
      return false;
   }

   /** Skip session registration */
   override canRegister(): boolean {
      return false;
   }
}

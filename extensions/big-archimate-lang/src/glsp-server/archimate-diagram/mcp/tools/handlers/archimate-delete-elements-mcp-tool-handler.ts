import { ARCHIMATE_CONCEPT_TYPE_MAP } from '@big-archimate/protocol';
import { DefaultTypes, DeleteElementOperation } from '@eclipse-glsp/server';
import { DeleteElementsInput, DeleteElementsMcpToolHandler, McpToolResult } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

/**
 * This class extends the default DeleteElementsMcpToolHandler to prevent
 * accidentally counting of icons and the like as separate concepts.
 */
@injectable()
export class ArchiMateDeleteElementsMcpToolHandler extends DeleteElementsMcpToolHandler {
   protected override async createResult({ elementIds }: DeleteElementsInput): Promise<McpToolResult> {
      const realIds = this.resolveExistingIds(elementIds);
      // Capture identities BEFORE dispatch — once deleted, `describeElement` returns undefined.
      const deletedElements = realIds
         .map(realId => this.describeElement(realId))
         .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
      const beforeCount = this.countExistingConcepts();
      await this.actionDispatcher.dispatch(DeleteElementOperation.create(realIds));
      const deletedCount = beforeCount - this.countExistingConcepts();
      return this.success(`Successfully deleted ${deletedCount} element(s) (including dependents)`, {
         deletedElements,
         deletedCount,
         dispatchedCommands: 1
      });
   }

   protected countExistingConcepts(): number {
      let total = 0;
      for (const id of this.modelState.index.allIds()) {
         const element = this.modelState.index.get(id);
         const isArchiMateConcept = ARCHIMATE_CONCEPT_TYPE_MAP.getReverse(element.type);
         if (!isArchiMateConcept && element.type !== DefaultTypes.GRAPH) {
            continue;
         }
         total += 1;
      }
      return total;
   }
}

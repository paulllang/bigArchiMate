import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import { DefaultMcpLabelProvider } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

@injectable()
export class ArchiMateMcpLabelProvider extends DefaultMcpLabelProvider {
   /**
    * Element nodes wrap their label in a header compartment, so the inherited lookup for a direct
    * `GLabel` child finds nothing - which silently dropped `text` on creation and left every element
    * without a reportable label. Groupings put the label directly on the node, hence the mixed
    * behaviour before.
    */
   override getLabel(element: GModelElement): GLabel | undefined {
      return this.findLabel(element, `${element.id}_label`);
   }

   /**
    * Looks for the label representing `element` itself, preferring the conventional `<id>_label`.
    *
    * Only compartments are descended into: a nested node is a diagram element in its own right (a
    * grouping holds the nodes placed inside it), and its label belongs to it rather than to `element`.
    */
   protected findLabel(element: GModelElement, preferredId: string): GLabel | undefined {
      let fallback: GLabel | undefined;
      for (const child of element.children) {
         if (child instanceof GLabel) {
            if (child.id === preferredId) {
               return child;
            }
            fallback ??= child;
         } else if (child instanceof GCompartment) {
            const nested = this.findLabel(child, preferredId);
            if (nested?.id === preferredId) {
               return nested;
            }
            fallback ??= nested;
         }
      }
      return fallback;
   }
}

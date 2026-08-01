import { GCompartment, GLabel, GModelElement } from '@eclipse-glsp/server';
import { DefaultMcpLabelProvider } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

@injectable()
export class ArchiMateMcpLabelProvider extends DefaultMcpLabelProvider {
   override getLabel(element: GModelElement): GLabel | undefined {
      return element.children
         .find((child): child is GCompartment => child instanceof GCompartment && child.id.endsWith('header'))
         ?.children.find((child): child is GLabel => child instanceof GLabel);
   }
}

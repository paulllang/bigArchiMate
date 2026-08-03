import { describe, expect, test } from '@jest/globals';
import { ELEMENT_ICON_TYPE, ELEMENT_LABEL_TYPE } from '@big-archimate/protocol';
import { GCompartment, GLabel, GNode } from '@eclipse-glsp/server';
import { ArchiMateMcpLabelProvider } from '../../src/glsp-server/archimate-diagram/mcp/archimate-mcp-label-provider.js';

/**
 * The MCP tool layer reads labels through this provider: `create-nodes` needs the label id to apply
 * `text`, and every tool result reports the label as the element's human-readable name.
 */
describe('ArchiMateMcpLabelProvider', () => {
   const provider = new ArchiMateMcpLabelProvider();

   /** Mirrors GElementNodeBuilder: the label lives in a header compartment next to an icon. */
   function elementNode(id: string, text: string): GNode {
      return GNode.builder()
         .id(id)
         .add(
            GCompartment.builder()
               .id(`${id}_header`)
               .add(GLabel.builder().type(ELEMENT_LABEL_TYPE).text(text).id(`${id}_label`).build())
               .build()
         )
         .add(GCompartment.builder().type(ELEMENT_ICON_TYPE).build())
         .build();
   }

   /** Mirrors the grouping branch, which puts the label directly on the node. */
   function groupingNode(id: string, text: string): GNode {
      return GNode.builder()
         .id(id)
         .add(GLabel.builder().type(ELEMENT_LABEL_TYPE).text(text).id(`${id}_label`).build())
         .build();
   }

   test('finds the label of an element node inside its header compartment', () => {
      const label = provider.getLabel(elementNode('BusinessActor1Node', 'Customer'));

      expect(label?.id).toBe('BusinessActor1Node_label');
      expect(label?.text).toBe('Customer');
   });

   test('finds the label of a grouping directly on the node', () => {
      const label = provider.getLabel(groupingNode('Grouping1Node', 'Back Office'));

      expect(label?.id).toBe('Grouping1Node_label');
      expect(label?.text).toBe('Back Office');
   });

   test('returns undefined for a node without a label, such as a junction', () => {
      expect(provider.getLabel(GNode.builder().id('AndNode').build())).toBeUndefined();
   });

   test('ignores labels belonging to nodes nested inside a grouping', () => {
      const grouping = GNode.builder()
         .id('Grouping1Node')
         .add(GLabel.builder().type(ELEMENT_LABEL_TYPE).text('Back Office').id('Grouping1Node_label').build())
         .add(elementNode('BusinessActor1Node', 'Customer'))
         .build();

      expect(provider.getLabel(grouping)?.text).toBe('Back Office');
   });

   test('does not report a contained node label as the grouping label', () => {
      // A grouping whose own label is missing must not borrow the label of a node placed inside it.
      const grouping = GNode.builder().id('Grouping1Node').add(elementNode('BusinessActor1Node', 'Customer')).build();

      expect(provider.getLabel(grouping)).toBeUndefined();
   });
});

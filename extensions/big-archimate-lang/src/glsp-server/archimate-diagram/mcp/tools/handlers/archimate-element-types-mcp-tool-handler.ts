/********************************************************************************
 * Copyright (c) 2026 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { ElementTypesMcpToolHandler } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';
import * as z from 'zod/v4';

const ArchiMateElementTypeEntrySchema = z.object({
   id: z.string().describe('Element type id used by `create-*` tools (e.g., `node:business-actor`).'),
   label: z.string().describe('Human-readable display name for the element TYPE (e.g., `Business Actor`).'),
   description: z.string().optional().describe('Human-readable definition according to the ArchiMate standard'),
   acceptsText: z
      .boolean()
      .optional()
      .describe('Whether `create-*` / `modify-*` tools should pass a `text` arg for elements of this type.'),
   layer: z.string().optional().describe('The ArchiMate layer to which the element belongs. Edges are considered to be layerless.')
});

const ArchiMateElementTypesOutputSchema = z.object({
   diagramType: z.string(),
   nodeTypes: z.array(ArchiMateElementTypeEntrySchema),
   edgeTypes: z.array(ArchiMateElementTypeEntrySchema)
});

/**
 * The sole purpose of this override is to align the default tool handler's wording
 * and to add the `layer` property, which would otherwise be missing in the outputSchema.
 */
@injectable()
export class ArchimateElementTypesMcpToolHandler extends ElementTypesMcpToolHandler {
   override readonly outputSchema = ArchiMateElementTypesOutputSchema;
}

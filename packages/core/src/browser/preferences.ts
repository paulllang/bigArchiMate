import {
    PreferenceSchema,
    PreferenceScope
} from '@theia/core/lib/common/preferences';

/**
 * The preference schema for the front-end of bigArchiMate.
 */
export const archimatePreferenceSchema: PreferenceSchema = {
    properties: {
        'big-archimate.mcp.port.number': {
            owner: 'bigArchiMate',
            type: 'integer',
            default: 64577,
            minimum: 1024,
            maximum: 65535,
            markdownDescription:
                'Port number used by the Dagram Editor (GLSP) MCP server. ' +
                'Ignored if `#big-archimate.mcp.port.random#` is checked/true. ' +
                'Requires restart to take effect.',
            scope: PreferenceScope.Workspace
        },
        'big-archimate.mcp.port.random': {
            owner: 'bigArchiMate',
            type: 'boolean',
            default: true,
            markdownDescription:
                'Use a random port for Dagram Editor (GLSP) MCP server. ' +
                'Overrides `#big-archimate.mcp.port.number#`. ' +
                'Requires restart to take effect.',
            scope: PreferenceScope.Workspace
        }
    }
};

export const ArchiMatePreferenceContribution = Symbol('ArchiMatePreferenceContribution');

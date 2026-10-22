import { PreferenceSchema, PreferenceScope } from '@theia/core/lib/common/preferences';

/**
 * The preference schema for the front-end of bigArchiMate.
 */
export const archimatePreferenceSchema: PreferenceSchema = {
   properties: {
      'big-archimate.mcp.port': {
         owner: 'bigArchiMate',
         type: 'integer',
         default: 0,
         minimum: 1024,
         maximum: 65535,
         markdownDescription:
            'Port number used by the Diagram Editor (GLSP) MCP server. ' +
            'When set to 0, a random port will be used. ' +
            'Reset settings to revert to 0. ' +
            'Requires restart to take effect.',
         scope: PreferenceScope.Workspace
      }
   }
};

export const ArchiMatePreferenceContribution = Symbol('ArchiMatePreferenceContribution');

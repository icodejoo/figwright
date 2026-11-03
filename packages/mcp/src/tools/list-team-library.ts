import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const listTeamLibraryTool: ToolSpec = {
  name: 'list_team_library',
  kind: 'read',
  description:
    'List published variable collections from libraries enabled in the current file only. Enable missing libraries in Figma Assets → Libraries; the Plugin API cannot enable them. libraryName is a case-insensitive substring filter. collectionKey lists variables in that available collection; resolvedType filters variables and requires collectionKey. limit defaults to 200, max 2000, with truncated:true when omitted rows remain. Returns {collections:[{name,key,libraryName}]} or {collection:{name,key,libraryName},variables:[{name,key,resolvedType}]}. Use variable keys with import_variable, then bind_variable_to_paint or rebind_variables. Native access/permission failures (including bare strings) propagate unchanged; uses async APIs for dynamic-page access.',
  inputSchema: z.object({
    libraryName: z.string().optional(),
    collectionKey: z.string().optional(),
    resolvedType: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']).optional(),
    limit: z.number().int().min(1).max(2000).default(200),
  }),
};

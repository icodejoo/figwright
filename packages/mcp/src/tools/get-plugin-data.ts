import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const getPluginDataTool: ToolSpec = {
  name: 'get_plugin_data',
  description:
    'Read plugin data on a node, style, variable or collection. With key returns {value} (empty string if absent); omit key for {data} containing every key in the selected namespace. Private data is scoped to this plugin id; shared data is public to all plugins.',
  inputSchema: z.object({
    targetType: z.enum(['NODE', 'STYLE', 'VARIABLE', 'VARIABLE_COLLECTION']),
    targetId: z.string(),
    namespace: z
      .string()
      .min(3)
      .optional()
      .describe('Shared namespace; omit for private data belonging to this plugin id'),
    key: z.string().optional(),
  }),
  kind: 'read',
};

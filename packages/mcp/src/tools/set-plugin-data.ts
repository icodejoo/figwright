import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const setPluginDataTool: ToolSpec = {
  name: 'set_plugin_data',
  description:
    'Write string plugin data on a node, style, variable or collection; empty string deletes the key. Entry including namespace/plugin id and key must fit 100 kB; Figma errors are returned unchanged. Shared namespace needs at least three alphanumeric characters and is public to all plugins.',
  inputSchema: z.object({
    targetType: z.enum(['NODE', 'STYLE', 'VARIABLE', 'VARIABLE_COLLECTION']),
    targetId: z.string(),
    namespace: z
      .string()
      .min(3)
      .optional()
      .describe('Shared namespace; omit for private data belonging to this plugin id'),
    key: z.string(),
    value: z.string(),
  }),
  kind: 'write',
};

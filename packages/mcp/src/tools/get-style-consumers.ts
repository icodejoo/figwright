import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const getStyleConsumersTool: ToolSpec = {
  name: 'get_style_consumers',
  description:
    'Find nodes using a style with getStyleConsumersAsync. Returns node ids, applied fields, page and parent path, plus truncated. Loads all pages; large files may take time or fail to load. Missing/inaccessible style ids fail. limit defaults to 1000 (max 10000); a truncated result is not an exhaustive dependency list.',
  inputSchema: z.object({
    styleId: z.string().describe('Style id in this file'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum returned consumers; default 1000'),
  }),
  kind: 'read',
};

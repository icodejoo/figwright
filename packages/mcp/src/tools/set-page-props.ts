import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const setPagePropsTool: ToolSpec = {
  name: 'set_page_props',
  description:
    'Set a page canvas background (SOLID paints only) and/or final zero-based page index. Page must exist; index must be within the document page list. Does not load page children. Returns {ok,nodeId}.',
  inputSchema: z.object({
    pageId: z.string(),
    index: z.number().int().min(0).optional(),
    backgrounds: z
      .array(
        z.object({
          type: z.literal('SOLID'),
          color: z.object({ r: z.number(), g: z.number(), b: z.number() }),
          opacity: z.number().min(0).max(1).optional(),
          visible: z.boolean().optional(),
        }),
      )
      .optional(),
  }),
  kind: 'write',
};

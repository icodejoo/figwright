import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const reorderStylesTool: ToolSpec = {
  name: 'reorder_styles',
  description:
    'Reorder a local style in Figma Design using moveLocal*StyleAfter. kind is PAINT, TEXT, EFFECT, GRID or CUSTOM_ANIMATION. Target and reference must be local, of the same kind and in the same folder. Omit afterStyleId (or pass null) to move first within that folder. Missing ids, remote styles, mismatched kinds/folders and unsupported editor/API fail; API errors are returned.',
  inputSchema: z.object({
    kind: z.enum(['PAINT', 'TEXT', 'EFFECT', 'GRID', 'CUSTOM_ANIMATION']).describe('Style kind'),
    styleId: z.string().describe('Local style to move'),
    afterStyleId: z
      .string()
      .nullable()
      .optional()
      .describe('Local reference style in the same folder; null/omitted means first'),
  }),
  kind: 'write',
};

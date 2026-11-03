import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const reorderStyleFoldersTool: ToolSpec = {
  name: 'reorder_style_folders',
  description:
    'Reorder an existing local style folder in Figma Design using moveLocal*FolderAfter. kind is PAINT, TEXT, EFFECT, GRID or CUSTOM_ANIMATION. Supply full slash-delimited folder paths (not style ids); target and reference must share a parent and contain styles of this kind. Omit afterFolder (or pass null) to move first in the parent. This changes order, not names or membership. Missing folders, different parents and unsupported editor/API fail; API errors are returned.',
  inputSchema: z.object({
    kind: z
      .enum(['PAINT', 'TEXT', 'EFFECT', 'GRID', 'CUSTOM_ANIMATION'])
      .describe('Kind of styles in the folders'),
    folder: z.string().min(1).describe('Full existing folder path, e.g. Typography/Headings'),
    afterFolder: z
      .string()
      .nullable()
      .optional()
      .describe('Sibling folder path; null/omitted means first'),
  }),
  kind: 'write',
};

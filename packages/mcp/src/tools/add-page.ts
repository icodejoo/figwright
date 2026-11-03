import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const ADD_PAGE_TOOL_NAME = 'add_page';

export const addPageTool: ToolSpec = {
  name: ADD_PAGE_TOOL_NAME,
  description: 'Create a new page (optionally named). Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    divider: z
      .boolean()
      .optional()
      .describe(
        'Create an empty page divider; name must be all asterisks, all en dashes, all em dashes or all spaces (default "---"); anything else is refused before creating, because Figma would silently make an ordinary page. Page limits still apply.',
      ),
    name: z.string().optional().describe('Optional page name'),
  }),
  kind: 'write',
};

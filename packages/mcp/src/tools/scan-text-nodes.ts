import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SCAN_TEXT_NODES_TOOL_NAME = 'scan_text_nodes';

export const scanTextNodesTool: ToolSpec = {
  name: SCAN_TEXT_NODES_TOOL_NAME,
  description:
    'brief=true returns only id, name, type, parentId, visible, characters for locating nodes; default false preserves full fields. Use get_node / get_design_context for styled details. ' +
    'limit (1–10000, omitted means unlimited) stops at the cap and returns truncated:true; further matches are not confirmed. Returns {nodes:[...]}. ' +
    'Return every TEXT node within a subtree, each with its characters / fontSize / fontName — ' +
    'text set along a path (TEXT_PATH) included. ' +
    'Scope with root (a node id); defaults to the current page.',
  inputSchema: z.object({
    brief: z
      .boolean()
      .optional()
      .describe('Return only basic identity and visibility plus characters; default false'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Stop at this many matches; omitted means unlimited'),
    root: z.string().describe('Node id to scope the scan; omit for the current page').optional(),
  }),
  kind: 'read',
};

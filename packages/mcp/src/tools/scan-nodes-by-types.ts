import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SCAN_NODES_BY_TYPES_TOOL_NAME = 'scan_nodes_by_types';

export const scanNodesByTypesTool: ToolSpec = {
  name: SCAN_NODES_BY_TYPES_TOOL_NAME,
  description:
    'brief=true returns only id, name, type, parentId, visible for locating nodes; default false preserves full fields. Use get_node / get_design_context for styled details. ' +
    'limit (1–10000, omitted means unlimited) stops at the cap and returns truncated:true; further matches are not confirmed. Returns {nodes:[...]}. ' +
    'Return a flat list of every node whose type is in `types`, searched recursively through a ' +
    'subtree scoped by `root` (a node id) or the current page by default. Use this to collect nodes ' +
    'by kind (e.g. all TEXT or COMPONENT nodes); to search by name use search_nodes, ' +
    'and for a styled tree snapshot use get_design_context. Returns { nodes: [...] }.',
  inputSchema: z.object({
    brief: z
      .boolean()
      .optional()
      .describe('Return only basic identity and visibility; default false'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Stop at this many matches; omitted means unlimited'),
    types: z.array(z.string()).describe('Node types to match, e.g. ["FRAME", "COMPONENT"]'),
    root: z.string().describe('Node id to scope the scan; omit for the current page').optional(),
  }),
  kind: 'read',
};

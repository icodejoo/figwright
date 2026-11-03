import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SEARCH_NODES_TOOL_NAME = 'search_nodes';

export const searchNodesTool: ToolSpec = {
  name: SEARCH_NODES_TOOL_NAME,
  description:
    'Search the node tree by case-insensitive name substring and/or exact node type. ' +
    'At least one of name, type, pluginData or sharedPluginData is required. Data criteria match key presence (OR within keys, AND between criteria). Scope to a subtree with root (a node id); ' +
    'defaults to the current page. Returns { nodes: [...] } in document order. ' +
    'brief=true returns only id, name, type, parentId (null when absent), visible; default false preserves full node fields. ' +
    'Use brief to locate nodes, then get_node / get_design_context for full fields. ' +
    'limit (1–10000, omitted means unlimited) stops traversal as soon as that many matches are found; ' +
    'only then returns truncated: true. This means the search stopped at the cap, not that further matches were confirmed. ' +
    'brief and limit can be used independently or together.',
  inputSchema: z.object({
    pluginData: z
      .object({ keys: z.array(z.string()).optional() })
      .optional()
      .describe('Private data presence; any listed key, or any private key when omitted'),
    sharedPluginData: z
      .object({ namespace: z.string().min(3), keys: z.array(z.string()).optional() })
      .optional()
      .describe('Shared data presence in namespace, any listed key or any key when omitted'),
    name: z.string().describe('Case-insensitive substring matched against node names').optional(),
    type: z.string().describe('Exact node type to match, e.g. "TEXT", "FRAME"').optional(),
    root: z.string().describe('Node id to scope the search; omit for the current page').optional(),
    brief: z
      .boolean()
      .optional()
      .describe('Return only id, name, type, parentId, visible; default false'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Stop at this many matches; omitted means unlimited'),
  }),
  kind: 'read',
};

import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REPARENT_NODES_TOOL_NAME = 'reparent_nodes';

export const reparentNodesTool: ToolSpec = {
  name: REPARENT_NODES_TOOL_NAME,
  description:
    'Move nodes into a different parent, optionally inserting at `index` (default: appended last). ' +
    'On-screen positions may shift because coordinates become relative to the new parent; nodes ' +
    'that no longer exist are skipped. To reorder within the current parent use reorder_nodes; to ' +
    'wrap nodes in a new frame/group use group_nodes. Into a GRID frame, pass rowAnchorIndex + ' +
    'columnAnchorIndex to drop a node into a specific empty cell in the same step (exactly one ' +
    'node, not together with index; the grid must be MANUAL, not ROW_AUTO_FLOW); without them ' +
    'Figma puts each node in the first free cell. Returns { ok, affected }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).describe('Node ids to move'),
    newParentId: z.string().describe('Id of the parent to move them into'),
    index: z.number().optional().describe('Optional insertion index within the new parent'),
    rowAnchorIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('GRID parent only: row of the cell to drop the node into (with columnAnchorIndex)'),
    columnAnchorIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('GRID parent only: column of the cell (with rowAnchorIndex)'),
  }),
  kind: 'write',
};

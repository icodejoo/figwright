import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_GRID_CHILD_TOOL_NAME = 'set_grid_child';

const ALIGN = ['MIN', 'CENTER', 'MAX', 'AUTO'] as const;

export const setGridChildTool: ToolSpec = {
  name: SET_GRID_CHILD_TOOL_NAME,
  description:
    'Place and align one child of a GRID auto-layout frame — the write half of the `gridChild` ' +
    'object get_node / get_design_context report. rowAnchorIndex + columnAnchorIndex (0-based, ' +
    'always given together) move the child to that cell; rowSpan / columnSpan make it occupy ' +
    'several tracks from its anchor (CSS grid-row / grid-column: span n); horizontalAlign / ' +
    'verticalAlign (MIN, CENTER, MAX, AUTO = the grid default) position it inside its cell ' +
    '(CSS justify-self / align-self). Any field may be omitted to leave it unchanged. Fails — and ' +
    'leaves the child as it was — when the node is not a direct child of a GRID frame, when the ' +
    'cell is out of range or already held by another child, when a span would overlap another ' +
    'child or run past the last row / column (add tracks first with set_auto_layout), or when ' +
    'a position is given while the grid has gridItemsPositioning ROW_AUTO_FLOW (cells then follow ' +
    'layer order: use reorder_nodes, or switch the grid to MANUAL). To drop a node into a grid at ' +
    'a cell in one step, use reparent_nodes with rowAnchorIndex / columnAnchorIndex. Inside a batch ' +
    'the node must already be a child of a GRID frame when the batch starts (a batch reads every ' +
    "op's starting state before applying any): create the grid and move the child in with separate " +
    'calls first, then batch set_grid_child. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Id of a direct child of a GRID frame'),
    rowAnchorIndex: z.number().int().min(0).optional().describe('Row of the cell (0 = top)'),
    columnAnchorIndex: z.number().int().min(0).optional().describe('Column of the cell (0 = left)'),
    rowSpan: z.number().int().positive().optional().describe('Rows occupied, from the anchor'),
    columnSpan: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Columns occupied, from the anchor'),
    horizontalAlign: z
      .enum(ALIGN)
      .optional()
      .describe('Horizontal position inside the cell; AUTO uses the grid default'),
    verticalAlign: z
      .enum(ALIGN)
      .optional()
      .describe('Vertical position inside the cell; AUTO uses the grid default'),
  }),
  kind: 'write',
};

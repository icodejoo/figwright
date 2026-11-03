import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REORDER_GRID_TRACKS_TOOL_NAME = 'reorder_grid_tracks';

export const reorderGridTracksTool: ToolSpec = {
  name: REORDER_GRID_TRACKS_TOOL_NAME,
  description:
    'Move whole rows or columns of a GRID auto-layout frame to a new position, shifting the ' +
    "others, with the children (and each track's size) travelling along. axis picks ROWS or " +
    'COLUMNS; fromIndices are the 0-based tracks to move (any order, duplicates ignored — a ' +
    'child spanning several tracks pulls all of them in, and the result lists those too); ' +
    'insertionIndex is where they land, counted against the ORIGINAL order, 0 to the track count ' +
    'inclusive (the count itself means "after the last"). Example: on a 3-row grid, ' +
    'fromIndices [0] + insertionIndex 3 moves the first row to the bottom. Every index is ' +
    'range-checked by Figma and a bad one leaves the grid unchanged. Use set_grid_child to move a ' +
    'single child instead. Not available while gridItemsPositioning is ROW_AUTO_FLOW — children ' +
    'then follow layer order, so reorder them with reorder_nodes. Not batchable: a rollback cannot ' +
    'guarantee restoring children that span several tracks, so call it on its own, outside batch. Returns { ok, nodeId, moves } ' +
    'where moves lists { from, to } for every track that changed index.',
  inputSchema: z.object({
    nodeId: z.string().describe('GRID auto-layout frame id'),
    axis: z.enum(['ROWS', 'COLUMNS']).describe('Which tracks to move'),
    fromIndices: z
      .array(z.number().int().min(0))
      .nonempty()
      .describe('0-based indices of the rows / columns to move'),
    insertionIndex: z
      .number()
      .int()
      .min(0)
      .describe('Where to insert them, against the original order (0 to the track count)'),
  }),
  kind: 'write',
};

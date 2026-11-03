import type { ReorderGridTracksResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type TrackMove = { from: number; to: number };
type TrackReorder = (options: {
  fromIndices: number[];
  insertionIndex: number;
}) => readonly TrackMove[];

type GridFrame = FrameNode & {
  gridItemsPositioning?: string;
  reorderRows: TrackReorder;
  reorderColumns: TrackReorder;
};

/**
 * Move whole rows / columns of a GRID frame (GridLayoutMixin.reorderRows / reorderColumns). Figma
 * range-checks every index and leaves the grid unchanged when one is bad, so the handler checks
 * only the shape of the arguments and the one case it can name better than Figma does.
 */
export const createReorderGridTracksHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('reorder_grid_tracks: nodeId must be a string');
    }
    if (p.axis !== 'ROWS' && p.axis !== 'COLUMNS') {
      throw new TypeError('reorder_grid_tracks: axis must be ROWS or COLUMNS');
    }
    if (
      !Array.isArray(p.fromIndices) ||
      p.fromIndices.length === 0 ||
      p.fromIndices.some(i => typeof i !== 'number' || !Number.isInteger(i) || i < 0)
    ) {
      throw new TypeError('reorder_grid_tracks: fromIndices must be a non-empty array of indices');
    }
    if (
      typeof p.insertionIndex !== 'number' ||
      !Number.isInteger(p.insertionIndex) ||
      p.insertionIndex < 0
    ) {
      throw new TypeError('reorder_grid_tracks: insertionIndex must be a non-negative integer');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || (node as { layoutMode?: unknown }).layoutMode !== 'GRID') {
      throw new Error(`reorder_grid_tracks: node ${p.nodeId} not found or not a GRID frame`);
    }
    const grid = node as GridFrame;
    if (grid.gridItemsPositioning === 'ROW_AUTO_FLOW') {
      throw new Error(
        `reorder_grid_tracks: ${p.nodeId} places its children by layer order (ROW_AUTO_FLOW), so ` +
          'its tracks have no fixed content to move — reorder the children with reorder_nodes, or ' +
          'set gridItemsPositioning MANUAL first',
      );
    }

    const options = {
      fromIndices: [...(p.fromIndices as number[])],
      insertionIndex: p.insertionIndex,
    };
    const moves = p.axis === 'ROWS' ? grid.reorderRows(options) : grid.reorderColumns(options);

    const result: ReorderGridTracksResult = {
      ok: true,
      nodeId: node.id,
      moves: moves.map(m => ({ from: m.from, to: m.to })),
    };
    return result;
  };

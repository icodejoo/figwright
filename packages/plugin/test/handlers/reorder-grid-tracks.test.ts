import type { ReorderGridTracksResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createReorderGridTracksHandler } from '../../src/handlers/reorder-grid-tracks.js';

type Options = { fromIndices: number[]; insertionIndex: number };

const makeGrid = (over: Record<string, unknown> = {}) => {
  const moves = [
    { from: 0, to: 2 },
    { from: 1, to: 0 },
    { from: 2, to: 1 },
  ];
  const grid = {
    id: 'G:1',
    layoutMode: 'GRID',
    gridItemsPositioning: 'MANUAL',
    reorderRows: vi.fn<(o: Options) => typeof moves>(() => moves),
    reorderColumns: vi.fn<(o: Options) => typeof moves>(() => [{ from: 3, to: 0 }]),
    ...over,
  };
  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => (id === 'G:1' ? grid : null),
  } as unknown as typeof figma;
  return { grid, handler: createReorderGridTracksHandler(figmaCtx) };
};

describe('reorder_grid_tracks handler', () => {
  it('moves rows and reports every track that changed index', async () => {
    const { grid, handler } = makeGrid();
    const result = (await handler({
      nodeId: 'G:1',
      axis: 'ROWS',
      fromIndices: [0],
      insertionIndex: 3,
    })) as ReorderGridTracksResult;

    expect(grid.reorderRows).toHaveBeenCalledWith({ fromIndices: [0], insertionIndex: 3 });
    expect(grid.reorderColumns).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      nodeId: 'G:1',
      moves: [
        { from: 0, to: 2 },
        { from: 1, to: 0 },
        { from: 2, to: 1 },
      ],
    });
  });

  it('moves columns through reorderColumns', async () => {
    const { grid, handler } = makeGrid();
    const result = (await handler({
      nodeId: 'G:1',
      axis: 'COLUMNS',
      fromIndices: [3],
      insertionIndex: 0,
    })) as ReorderGridTracksResult;
    expect(grid.reorderColumns).toHaveBeenCalledWith({ fromIndices: [3], insertionIndex: 0 });
    expect(result.moves).toEqual([{ from: 3, to: 0 }]);
  });

  it('hands Figma its own copy of fromIndices', async () => {
    const { grid, handler } = makeGrid();
    const from = [1, 0];
    await handler({ nodeId: 'G:1', axis: 'ROWS', fromIndices: from, insertionIndex: 2 });
    expect(grid.reorderRows.mock.calls[0]![0].fromIndices).not.toBe(from);
  });

  it('rejects bad arguments before touching the grid', async () => {
    const { grid, handler } = makeGrid();
    const ok = { nodeId: 'G:1', axis: 'ROWS', fromIndices: [0], insertionIndex: 1 };
    await expect(handler({ ...ok, nodeId: 5 })).rejects.toThrow(/nodeId/);
    await expect(handler({ ...ok, axis: 'DIAGONAL' })).rejects.toThrow(/axis/);
    await expect(handler({ ...ok, fromIndices: [] })).rejects.toThrow(/fromIndices/);
    await expect(handler({ ...ok, fromIndices: [0.5] })).rejects.toThrow(/fromIndices/);
    await expect(handler({ ...ok, insertionIndex: -1 })).rejects.toThrow(/insertionIndex/);
    expect(grid.reorderRows).not.toHaveBeenCalled();
  });

  it('refuses a missing node, a non-GRID frame and a ROW_AUTO_FLOW grid', async () => {
    const ok = { axis: 'ROWS', fromIndices: [0], insertionIndex: 1 };
    await expect(makeGrid().handler({ ...ok, nodeId: '9:9' })).rejects.toThrow(/not a GRID/);
    await expect(
      makeGrid({ layoutMode: 'VERTICAL' }).handler({ ...ok, nodeId: 'G:1' }),
    ).rejects.toThrow(/not a GRID/);
    const flowing = makeGrid({ gridItemsPositioning: 'ROW_AUTO_FLOW' });
    await expect(flowing.handler({ ...ok, nodeId: 'G:1' })).rejects.toThrow(/ROW_AUTO_FLOW/);
    expect(flowing.grid.reorderRows).not.toHaveBeenCalled();
  });

  it('lets a Figma range error through untouched', async () => {
    const { handler } = makeGrid({
      reorderRows: () => {
        throw new Error('insertionIndex out of range');
      },
    });
    await expect(
      handler({ nodeId: 'G:1', axis: 'ROWS', fromIndices: [0], insertionIndex: 99 }),
    ).rejects.toThrow(/out of range/);
  });
});

import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetGridChildHandler } from '../../src/handlers/set-grid-child.js';

interface FakeChild extends Record<string, unknown> {
  id: string;
  parent: Record<string, unknown> | null;
  gridRowAnchorIndex: number;
  gridColumnAnchorIndex: number;
  gridRowSpan: number;
  gridColumnSpan: number;
  gridChildHorizontalAlign: string;
  gridChildVerticalAlign: string;
  setGridChildPosition: (row: number, column: number) => void;
}

/**
 * A 3 x 3 grid with one child that behaves the way Figma was measured to: a cell outside the grid
 * or held by another child is refused, a span that would overlap another child or leave the grid is
 * refused, and the anchors are only writable through setGridChildPosition. `blocked` lists cells
 * another child holds.
 */
const makeGrid = (
  over: { positioning?: string; layoutMode?: string; blocked?: [number, number][] } = {},
) => {
  const blocked = over.blocked ?? [];
  const parent = {
    id: 'G:1',
    layoutMode: over.layoutMode ?? 'GRID',
    gridItemsPositioning: over.positioning ?? 'MANUAL',
  };
  const writes: string[] = [];
  const hits = (r: number, c: number, rs: number, cs: number): boolean =>
    blocked.some(([br, bc]) => br >= r && br < r + rs && bc >= c && bc < c + cs);
  const state = { row: 0, column: 0, rowSpan: 1, columnSpan: 1 };
  const child = {
    id: '1:1',
    parent,
    get gridRowAnchorIndex() {
      return state.row;
    },
    get gridColumnAnchorIndex() {
      return state.column;
    },
    get gridRowSpan() {
      return state.rowSpan;
    },
    set gridRowSpan(v: number) {
      if (state.row + v > 3 || hits(state.row, state.column, v, state.columnSpan)) {
        throw new Error('span overlaps another child or leaves the grid');
      }
      writes.push(`rowSpan=${v}`);
      state.rowSpan = v;
    },
    get gridColumnSpan() {
      return state.columnSpan;
    },
    set gridColumnSpan(v: number) {
      if (state.column + v > 3 || hits(state.row, state.column, state.rowSpan, v)) {
        throw new Error('span overlaps another child or leaves the grid');
      }
      writes.push(`columnSpan=${v}`);
      state.columnSpan = v;
    },
    gridChildHorizontalAlign: 'AUTO',
    gridChildVerticalAlign: 'AUTO',
    setGridChildPosition(r: number, c: number) {
      if (r > 2 || c > 2) throw new Error('out of bounds of the grid');
      if (hits(r, c, state.rowSpan, state.columnSpan)) throw new Error('cell is occupied');
      writes.push(`cell=${r},${c}`);
      state.row = r;
      state.column = c;
    },
  } as unknown as FakeChild;
  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => (id === '1:1' ? child : null),
  } as unknown as typeof figma;
  return { child, parent, state, writes, handler: createSetGridChildHandler(figmaCtx) };
};

describe('set_grid_child handler', () => {
  it('moves a child to a cell, spans it and aligns it in one call', async () => {
    const { child, state, handler } = makeGrid();
    const result = (await handler({
      nodeId: '1:1',
      rowAnchorIndex: 1,
      columnAnchorIndex: 0,
      columnSpan: 2,
      horizontalAlign: 'CENTER',
      verticalAlign: 'MAX',
    })) as MutateResult;

    expect(state).toEqual({ row: 1, column: 0, rowSpan: 1, columnSpan: 2 });
    expect(child.gridChildHorizontalAlign).toBe('CENTER');
    expect(child.gridChildVerticalAlign).toBe('MAX');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('changes only the span, leaving the cell alone', async () => {
    const { state, writes, handler } = makeGrid();
    await handler({ nodeId: '1:1', rowSpan: 2 });
    expect(state).toEqual({ row: 0, column: 0, rowSpan: 2, columnSpan: 1 });
    expect(writes).toEqual(['rowSpan=2']);
  });

  it('keeps a spanning child spanning when it only moves', async () => {
    const { state, handler } = makeGrid();
    await handler({ nodeId: '1:1', columnSpan: 2 });
    await handler({ nodeId: '1:1', rowAnchorIndex: 2, columnAnchorIndex: 0 });
    expect(state).toEqual({ row: 2, column: 0, rowSpan: 1, columnSpan: 2 });
  });

  it('refuses a row without a column, and values that are not indices, before writing', async () => {
    const { writes, handler } = makeGrid();
    await expect(handler({ nodeId: '1:1', rowAnchorIndex: 1 })).rejects.toThrow(/go together/);
    await expect(
      handler({ nodeId: '1:1', rowAnchorIndex: -1, columnAnchorIndex: 0 }),
    ).rejects.toThrow(/non-negative integer/);
    await expect(handler({ nodeId: '1:1', rowSpan: 0 })).rejects.toThrow(/positive integer/);
    await expect(handler({ nodeId: '1:1', horizontalAlign: 'LEFT' })).rejects.toThrow(
      /MIN \/ CENTER \/ MAX \/ AUTO/,
    );
    await expect(handler({})).rejects.toThrow(/nodeId/);
    expect(writes).toEqual([]);
  });

  it('refuses a node that is not a child of a GRID frame', async () => {
    const { handler } = makeGrid({ layoutMode: 'HORIZONTAL' });
    await expect(handler({ nodeId: '1:1', rowSpan: 2 })).rejects.toThrow(/not a direct child/);
    await expect(handler({ nodeId: '9:9', rowSpan: 2 })).rejects.toThrow(/not a direct child/);
  });

  it('refuses a cell on a ROW_AUTO_FLOW grid but still allows span and alignment', async () => {
    const { state, handler } = makeGrid({ positioning: 'ROW_AUTO_FLOW' });
    await expect(
      handler({ nodeId: '1:1', rowAnchorIndex: 1, columnAnchorIndex: 1 }),
    ).rejects.toThrow(/ROW_AUTO_FLOW/);
    await handler({ nodeId: '1:1', columnSpan: 2, verticalAlign: 'CENTER' });
    expect(state.columnSpan).toBe(2);
  });

  it('puts the child back exactly when Figma refuses part of the placement', async () => {
    // The cell is free but the requested span would run into the child at 0,2 — the call fails
    // after the child has already moved, and must not leave it half placed.
    const { child, state, handler } = makeGrid({ blocked: [[1, 2]] });
    await handler({ nodeId: '1:1', columnSpan: 2, horizontalAlign: 'MIN' });
    const before = { ...state };

    await expect(
      handler({
        nodeId: '1:1',
        rowAnchorIndex: 1,
        columnAnchorIndex: 0,
        columnSpan: 3,
        horizontalAlign: 'MAX',
      }),
    ).rejects.toThrow(/left as it was/);

    expect(state).toEqual(before);
    expect(child.gridChildHorizontalAlign).toBe('MIN');
  });
});

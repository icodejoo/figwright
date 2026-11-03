import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createReparentNodesHandler } from '../../src/handlers/reparent-nodes.js';

const makeFigma = (parent: unknown, children: Record<string, unknown>): typeof figma => {
  const lookup: Record<string, unknown> = { '2:0': parent, ...children };
  return { getNodeByIdAsync: async (id: string) => lookup[id] ?? null } as unknown as typeof figma;
};

describe('reparent_nodes handler', () => {
  it('appends nodes to the new parent and returns affected ids', async () => {
    const appendChild = vi.fn<() => void>();
    const parent = { id: '2:0', appendChild };
    const a = { id: '1:1', parent: { id: '1:0' } };
    const handler = createReparentNodesHandler(makeFigma(parent, { '1:1': a }));
    const result = (await handler({ nodeIds: ['1:1'], newParentId: '2:0' })) as BatchNodeResult;

    expect(appendChild).toHaveBeenCalledWith(a);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('inserts at index when provided', async () => {
    const insertChild = vi.fn<() => void>();
    const parent = { id: '2:0', appendChild: vi.fn<() => void>(), insertChild };
    const a = { id: '1:1', parent: { id: '1:0' } };
    const handler = createReparentNodesHandler(makeFigma(parent, { '1:1': a }));
    await handler({ nodeIds: ['1:1'], newParentId: '2:0', index: 0 });
    expect(insertChild).toHaveBeenCalledWith(0, a);
  });

  it('throws on bad input or invalid parent', async () => {
    const f = makeFigma(null, {});
    await expect(
      createReparentNodesHandler(f)({ nodeIds: 'x', newParentId: '2:0' }),
    ).rejects.toThrow(/nodeIds/);
    await expect(createReparentNodesHandler(f)({ nodeIds: ['1:1'] })).rejects.toThrow(
      /newParentId/,
    );
    await expect(
      createReparentNodesHandler(f)({ nodeIds: ['1:1'], newParentId: '9:9' }),
    ).rejects.toThrow(/not found or cannot contain/);
  });
});

describe('reparent_nodes into a grid cell', () => {
  const makeGrid = (over: Record<string, unknown> = {}) => {
    const appendChildAt = vi.fn<() => void>();
    const appendChild = vi.fn<() => void>();
    const parent = {
      id: '2:0',
      layoutMode: 'GRID',
      gridItemsPositioning: 'MANUAL',
      appendChild,
      insertChild: vi.fn<() => void>(),
      appendChildAt,
      ...over,
    };
    const a = { id: '1:1', parent: { id: '1:0' } };
    const b = { id: '1:2', parent: { id: '1:0' } };
    const handler = createReparentNodesHandler(makeFigma(parent, { '1:1': a, '1:2': b }));
    return { parent, a, handler, appendChild, appendChildAt };
  };

  it('drops the node into the given cell instead of the first free one', async () => {
    const { a, handler, appendChild, appendChildAt } = makeGrid();
    const result = (await handler({
      nodeIds: ['1:1'],
      newParentId: '2:0',
      rowAnchorIndex: 1,
      columnAnchorIndex: 2,
    })) as BatchNodeResult;
    expect(appendChildAt).toHaveBeenCalledWith(a, 1, 2);
    expect(appendChild).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('refuses a cell on a non-grid parent, a flowing grid, several nodes, or an index too', async () => {
    const base = { nodeIds: ['1:1'], newParentId: '2:0', rowAnchorIndex: 0, columnAnchorIndex: 0 };
    const flat = makeGrid({ layoutMode: 'VERTICAL' });
    await expect(flat.handler(base)).rejects.toThrow(/not a GRID frame/);
    const flowing = makeGrid({ gridItemsPositioning: 'ROW_AUTO_FLOW' });
    await expect(flowing.handler(base)).rejects.toThrow(/ROW_AUTO_FLOW/);
    const grid = makeGrid();
    await expect(grid.handler({ ...base, nodeIds: ['1:1', '1:2'] })).rejects.toThrow(
      /exactly one nodeId/,
    );
    await expect(grid.handler({ ...base, index: 0 })).rejects.toThrow(/a cell or an index/);
    await expect(
      grid.handler({ nodeIds: ['1:1'], newParentId: '2:0', rowAnchorIndex: 1 }),
    ).rejects.toThrow(/go together/);
    await expect(grid.handler({ ...base, rowAnchorIndex: -1 })).rejects.toThrow(/indices/);
    // Nothing moved on any refusal.
    expect(grid.appendChildAt).not.toHaveBeenCalled();
  });
});

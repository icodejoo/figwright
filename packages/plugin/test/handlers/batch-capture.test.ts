import { describe, expect, it, vi } from 'vitest';

import { captureOverrideGuard, type InstanceGuard } from '../../src/handlers/batch-overrides.js';
import {
  captureLayoutScope,
  type LayoutScope,
  restoreLayoutDrift,
} from '../../src/handlers/batch-snapshot.js';
import { createBatchHandler } from '../../src/handlers/batch.js';
import { createCreateRectangleHandler } from '../../src/handlers/create-rectangle.js';

const fake = (childCount = 1) => {
  const store = new Map<string, ReturnType<typeof box>>();
  function box(id: string) {
    const node = {
      id,
      type: 'RECTANGLE',
      name: id,
      opacity: 1,
      parent: null as unknown,
      width: 100,
      height: 100,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
      resizeWithoutConstraints: vi.fn<
        (this: { width: number; height: number }, w: number, h: number) => void
      >(function (this: { width: number; height: number }, w: number, h: number) {
        this.width = w;
        this.height = h;
      }),
      remove() {
        store.delete(id);
      },
    };
    store.set(id, node);
    return node;
  }
  const child = box('child');
  const children = [
    child,
    ...Array.from({ length: childCount - 1 }, (_, i) => box(`sibling:${i}`)),
  ];
  const readChildren = vi.fn<() => typeof children>(() => children);
  const parent = {
    ...box('P'),
    type: 'FRAME',
    layoutMode: 'NONE',
    get children() {
      return readChildren();
    },
    findAll: vi.fn<() => typeof children>((): typeof children => [...parent.children]),
    appendChild(node: ReturnType<typeof box>) {
      node.parent = parent;
      children.push(node);
      // Model lossy constraint drift, including during removal, so every undo must restore again.
      child.width += 10;
      node.remove = () => {
        children.splice(children.indexOf(node), 1);
        store.delete(node.id);
        child.width -= 3;
      };
    },
  };
  for (const node of children) node.parent = parent;
  store.set('P', parent);
  const q = { ...box('Q'), type: 'FRAME', findAll: vi.fn<() => never[]>(() => []) };
  store.set('Q', q);
  let sequence = 0;
  const api = {
    root: { children: [] },
    getNodeByIdAsync: vi.fn<(id: string) => Promise<ReturnType<typeof box> | null>>(
      async (id: string) => store.get(id) ?? null,
    ),
    createRectangle: () => box(`new:${++sequence}`),
  } as unknown as typeof figma;
  return { api, parent, q, child, children, readChildren, store };
};

describe('batch capture sharing', () => {
  it('captures a shared parent once across concurrent creates and starts fresh next batch', async () => {
    const { api, parent, readChildren } = fake(1000);
    const apply = { create_rectangle: createCreateRectangleHandler(api) };
    const batch = createBatchHandler(api, apply);
    const ops = Array.from({ length: 50 }, () => ({
      tool: 'create_rectangle',
      params: { parentId: 'P' },
    }));
    await batch({ ops });
    expect(parent.findAll).toHaveBeenCalledTimes(1);
    expect(readChildren).toHaveBeenCalledTimes(1);
    await batch({ ops });
    expect(parent.findAll).toHaveBeenCalledTimes(2);
    expect(readChildren).toHaveBeenCalledTimes(2);
  });

  it('preserves overlapping resized sets, shares geometry objects, and restores idempotently', async () => {
    const { api, parent, q, child } = fake();
    const cache = new Map<string, Promise<LayoutScope>>();
    const [p, pq, qp] = await Promise.all([
      captureLayoutScope(api, ['P'], cache),
      captureLayoutScope(api, ['P', 'Q'], cache),
      captureLayoutScope(api, ['Q', 'P'], cache),
    ]);
    expect(parent.findAll).toHaveBeenCalledTimes(1);
    expect(q.findAll).toHaveBeenCalledTimes(1);
    expect(pq).toEqual(await captureLayoutScope(api, ['P', 'Q']));
    expect(qp).toEqual(await captureLayoutScope(api, ['Q', 'P']));
    expect(pq[0]).toBe(p[0]);
    expect(pq.map(s => s.id)).toEqual(['P', 'child', 'Q']);
    child.width = 1;
    q.width = 2;
    await restoreLayoutDrift(api, pq);
    await restoreLayoutDrift(api, p);
    await restoreLayoutDrift(api, pq);
    expect(child.width).toBe(100);
    expect(q.width).toBe(100);
    expect(child.resizeWithoutConstraints).toHaveBeenCalledTimes(1);
    expect(q.resizeWithoutConstraints).toHaveBeenCalledTimes(1);
  });

  it('shares a layout-coupled ancestor reached through distinct resized ids', async () => {
    const { api, parent, child } = fake();
    parent.layoutMode = 'HORIZONTAL';
    const cache = new Map<string, Promise<LayoutScope>>();
    await Promise.all([
      captureLayoutScope(api, ['P'], cache),
      captureLayoutScope(api, [child.id], cache),
    ]);
    expect(parent.findAll).toHaveBeenCalledTimes(1);
  });

  it('keeps both roots when batch resized sets partially overlap, including on rollback', async () => {
    const { api, parent, q, child } = fake();
    const batch = createBatchHandler(api, {
      resize_nodes: async params => {
        const { nodeIds } = params as { nodeIds: string[] };
        if (nodeIds.includes('P')) {
          parent.width = 5;
          child.width = 3;
        }
        if (nodeIds.includes('Q')) q.width = 7;
        return { ok: true };
      },
      set_opacity: async () => {
        throw new Error('refused');
      },
    });
    await expect(
      batch({
        ops: [
          { tool: 'resize_nodes', params: { nodeIds: ['P'], width: 5 } },
          { tool: 'resize_nodes', params: { nodeIds: ['P', 'Q'], width: 7 } },
          { tool: 'set_opacity', params: { nodeId: 'child', opacity: 0 } },
        ],
      }),
    ).rejects.toThrow('rolled back 2 applied op(s)');
    expect(parent.findAll).toHaveBeenCalledTimes(1);
    expect(q.findAll).toHaveBeenCalledTimes(1);
    expect([parent.width, q.width, child.width]).toEqual([100, 100, 100]);
  });

  it('shares a rejected capture promise and applies nothing', async () => {
    const { api, parent } = fake();
    parent.findAll.mockImplementation(() => {
      throw new Error('read failed');
    });
    const create = vi.fn<() => Promise<void>>(async () => {});
    const batch = createBatchHandler(api, { create_rectangle: create });
    await expect(
      batch({
        ops: Array.from({ length: 20 }, () => ({
          tool: 'create_rectangle',
          params: { parentId: 'P' },
        })),
      }),
    ).rejects.toThrow('read failed');
    expect(parent.findAll).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('restores pre-batch children, ids and geometry after multiple creates and a failure', async () => {
    const { api, parent, child, children, store } = fake();
    const before = [...store.keys()];
    const batch = createBatchHandler(api, {
      create_rectangle: createCreateRectangleHandler(api),
      set_opacity: async () => {
        throw new Error('refused');
      },
    });
    await expect(
      batch({
        ops: [
          ...Array.from({ length: 5 }, () => ({
            tool: 'create_rectangle',
            params: { parentId: 'P' },
          })),
          { tool: 'set_opacity', params: { nodeId: 'child', opacity: 0 } },
        ],
      }),
    ).rejects.toThrow('rolled back 5 applied op(s)');
    expect([...store.keys()]).toEqual(before);
    expect(children).toEqual([child]);
    expect(child.width).toBe(100);
    expect(parent.width).toBe(100);
    // Removal disturbs the box again after each restore; sharing must not skip any undo restore.
    expect(child.resizeWithoutConstraints).toHaveBeenCalledTimes(5);
    expect(parent.findAll).toHaveBeenCalledTimes(1);
  });

  it('shares instance subtree captures across concurrent overlapping touched ids', async () => {
    const { api, parent, child, store } = fake();
    const inst = Object.assign(parent, {
      type: 'INSTANCE',
      overrides: [],
      findAllWithCriteria: vi.fn<() => never[]>(() => []),
    });
    const cache = new Map<string, Promise<InstanceGuard>>();
    const [a, b] = await Promise.all([
      captureOverrideGuard(api, [child.id], cache),
      captureOverrideGuard(api, [child.id, 'P'], cache),
    ]);
    expect(store.get('P')).toBe(inst);
    expect(inst.findAllWithCriteria).toHaveBeenCalledTimes(1);
    expect(a[0]).toBe(b[0]);
  });

  it('reads parent child order once for concurrent reorder captures', async () => {
    const { api, parent, readChildren } = fake();
    Object.assign(parent, { insertChild: vi.fn<() => void>() });
    const batch = createBatchHandler(api, { reorder_nodes: async () => ({ ok: true }) });
    await batch({
      ops: Array.from({ length: 20 }, () => ({
        tool: 'reorder_nodes',
        params: { nodeIds: ['child'], position: 'front' },
      })),
    });
    expect(readChildren).toHaveBeenCalledTimes(1);
  });
});

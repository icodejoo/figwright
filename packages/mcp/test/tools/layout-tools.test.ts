import type { LayoutJob, LayoutReply } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { handleLayoutTool, packLayout } from '../../src/tools/layout-tools.js';

/** 空插件响应。 */
const reply = (fields: Partial<LayoutReply> = {}): LayoutReply => ({
  issues: [],
  changes: [],
  jobs: [],
  containers: [],
  rollback: [],
  errors: [],
  ...fields,
});
/** 异形矩形装箱任务。 */
const job = (): LayoutJob => ({
  id: 'root',
  boxes: [
    { id: 'a', width: 320, height: 80 },
    { id: 'b', width: 80, height: 280 },
    { id: 'c', width: 120, height: 150 },
  ],
  members: {
    a: [
      { id: 'a', x: 0, y: 0 },
      { id: 'mask', x: 10, y: 5 },
    ],
    b: [{ id: 'b', x: 0, y: 0 }],
    c: [{ id: 'c', x: 0, y: 0 }],
  },
  gap: 24,
  padX: 16,
  padY: 20,
});

describe('server layout packing', () => {
  it('preserves cluster offsets, fits every non-rotated box and leaves requested gaps', () => {
    const task = job(),
      changes = packLayout(task);
    const positions = new Map(changes.map(c => [c.id, c]));
    const root = positions.get('root')!;
    expect(positions.get('mask')!.x! - positions.get('a')!.x!).toBe(10);
    expect(positions.get('mask')!.y! - positions.get('a')!.y!).toBe(5);
    for (const a of task.boxes) {
      const p = positions.get(a.id)!;
      expect(p.x).toBeGreaterThanOrEqual(16);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.x! + a.width).toBeLessThanOrEqual(root.width! - 16);
      expect(p.y! + a.height).toBeLessThanOrEqual(root.height! - 20);
      for (const b of task.boxes.filter(box => box.id !== a.id)) {
        const q = positions.get(b.id)!;
        expect(
          p.x! + a.width + 24 <= q.x! ||
            q.x! + b.width + 24 <= p.x! ||
            p.y! + a.height + 24 <= q.y! ||
            q.y! + b.height + 24 <= p.y!,
        ).toBe(true);
      }
    }
  });

  it('uses tightening fallback if clustering would not improve area', () => {
    const task = job();
    task.originalArea = 1;
    task.fallback = [{ id: 'root', width: 500, height: 400 }];
    expect(packLayout(task)).toEqual(task.fallback);
  });

  it('handles empty, oversize and invalid input without writing', () => {
    expect(packLayout({ ...job(), boxes: [] })).toEqual([]);
    expect(() => packLayout({ ...job(), boxes: [{ id: 'a', width: NaN, height: 1 }] })).toThrow(
      '有限正数',
    );
    const task = job();
    task.boxes = [{ id: 'a', width: 25000, height: 30 }];
    expect(packLayout(task).at(-1)).toMatchObject({ width: 25032, height: 70 });
  });
});

describe('layout orchestration', () => {
  it('audit read-only does not send changes and fix rereads until clean', async () => {
    const dispatch = vi.fn<() => Promise<LayoutReply>>(async () =>
      reply({ issues: [{ id: 'bad' }], changes: [{ id: 'bad', width: 100 }] }),
    );
    expect(
      await handleLayoutTool(dispatch, 'audit_layout', { nodeId: 'root', fix: false }),
    ).toMatchObject({ clean: false, passes: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    dispatch.mockReset();
    dispatch
      .mockResolvedValueOnce(
        reply({ issues: [{ id: 'bad' }], changes: [{ id: 'bad', width: 100 }] }),
      )
      .mockResolvedValueOnce(
        reply({
          rollback: [{ before: { id: 'bad', width: 200 }, after: { id: 'bad', width: 100 } }],
        }),
      )
      .mockResolvedValue(reply());
    expect(
      await handleLayoutTool(dispatch, 'audit_layout', { nodeId: 'root', fix: true }),
    ).toMatchObject({ clean: true, passes: 1, rollback: [{ before: { width: 200 } }] });
  });

  it('hierarchy rereads every container inside-out and executes two passes', async () => {
    const calls: unknown[] = [];
    const dispatch = vi.fn<(tool: string, args: unknown) => Promise<LayoutReply>>(
      async (_tool, args) => {
        calls.push(args);
        return reply({ containers: ['inner', 'outer'] });
      },
    );
    expect(await handleLayoutTool(dispatch, 'relayout_frames', { nodeId: 'root' })).toMatchObject({
      complete: true,
      passes: 2,
    });
    expect(calls).toEqual([
      { nodeId: 'root' },
      { nodeId: 'root', containerId: 'inner' },
      { nodeId: 'root', containerId: 'outer' },
      { nodeId: 'root' },
      { nodeId: 'root', containerId: 'inner' },
      { nodeId: 'root', containerId: 'outer' },
      { nodeId: 'root' },
    ]);
  });

  it('reports non-convergence and transport failures without claiming clean', async () => {
    const unresolved = vi.fn<() => Promise<LayoutReply>>(async () =>
      reply({ issues: [{ id: 'bad' }] }),
    );
    expect(
      await handleLayoutTool(unresolved, 'audit_layout', { nodeId: 'root', fix: true }),
    ).toMatchObject({ clean: false });
    const failed = vi.fn<() => Promise<LayoutReply>>(async () => {
      throw new Error('offline');
    });
    expect(await handleLayoutTool(failed, 'relayout_frames', { nodeId: 'root' })).toMatchObject({
      complete: false,
      errors: [{ message: expect.stringContaining('offline') }],
    });
  });
});

describe('flatten orchestration', () => {
  it('previews without writing and rereads each stage before applying', async () => {
    const dispatch = vi.fn<(tool: string, args: unknown) => Promise<LayoutReply>>(
      async (_tool, args) => {
        const p = args as { changes?: unknown };
        return p.changes
          ? reply({
              rollback: [
                {
                  before: { id: 'frag', parentId: 'shell' },
                  after: { id: 'frag', parentId: 'stage' },
                },
              ],
            })
          : reply({ containers: ['stage'], changes: [{ id: 'frag', parentId: 'stage' }] });
      },
    );
    expect(
      await handleLayoutTool(dispatch, 'flatten_stage', { nodeId: 'root', fix: false }),
    ).toMatchObject({ complete: true, passes: 0, rollback: [] });
    expect(dispatch).toHaveBeenCalledTimes(1);
    dispatch.mockClear();
    expect(
      await handleLayoutTool(dispatch, 'flatten_stage', { nodeId: 'root', fix: true }),
    ).toMatchObject({ complete: true, passes: 1, rollback: [{ before: { parentId: 'shell' } }] });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch.mock.calls[1]?.[1]).toMatchObject({ containerId: 'stage' });
  });
});

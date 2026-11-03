import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToolCall } from '../protocol/bridge.js';
import { TimeSlice } from '../src/cooperative.js';
import { dispatchSandboxMessage } from '../src/dispatcher.js';
import { createLoadPageHandler } from '../src/handlers/load-page.js';
import { createSandboxHandlers } from '../src/handlers/registry.js';
import { createIdempotencyCache } from '../src/idempotency.js';
import { withInstanceIdLookup } from '../src/node-lookup.js';
import { beginPerf, finishPerf, perfStats, withPerfApi } from '../src/perf.js';
import { serializeTrees } from '../src/serializer.js';
import { collectMatches } from '../src/traverse.js';

afterEach(() => {
  perfStats({ enabled: false, reset: true });
  vi.restoreAllMocks();
});
const call = (id = 'one', tool = 'get_node') => beginPerf(id, tool)!;
describe('performance observations', () => {
  it('does not allocate records by default; records only after enabling', () => {
    expect(beginPerf('disabled', 'get_node')).toBeUndefined();
    perfStats({ enabled: true });
    expect(call()).toMatchObject({ tool: 'get_node', queueMs: 0 });
  });
  it('retains the newest 200 completions and computes nearest-rank percentiles of returned rows', () => {
    perfStats({ enabled: true });
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 1; i <= 205; i++) {
      const row = call(String(i));
      now += i;
      finishPerf(row);
    }
    const result = perfStats({ limit: 200 });
    expect(result.bufferSize).toBe(200);
    expect(result.calls[0]!.id).toBe('205');
    expect(result.summary.get_node).toMatchObject({
      count: 200,
      p50Ms: 105,
      p95Ms: 195,
      maxMs: 205,
    });
    expect(perfStats({ tool: 'other' }).calls).toEqual([]);
    expect(perfStats({ reset: true }).bufferSize).toBe(200);
    expect(perfStats({}).bufferSize).toBe(0);
  });
  it('keeps overlapping by-id calls isolated, including rejected calls', async () => {
    perfStats({ enabled: true });
    let resolve!: (value: BaseNode | null) => void;
    const pending = new Promise<BaseNode | null>(done => {
      resolve = done;
    });
    const api = {
      getNodeByIdAsync: vi.fn<(id: string) => Promise<BaseNode | null>>((id: string) =>
        id === 'slow' ? pending : Promise.reject(new Error('Figma original')),
      ),
    } as unknown as typeof figma;
    const first = call('first');
    const second = call('second');
    const a = withInstanceIdLookup(withPerfApi(api, first));
    const b = withInstanceIdLookup(withPerfApi(api, second));
    const waiting = a.getNodeByIdAsync('slow');
    await expect(b.getNodeByIdAsync('fast')).rejects.toThrow('Figma original');
    resolve(null);
    await waiting;
    expect(first.byId.count).toBe(1);
    expect(second.byId.count).toBe(1);
  });
  it('preserves shared instance fallback state across scoped calls and times each native attempt', async () => {
    perfStats({ enabled: true });
    const child = { id: 'I1:1;2:2' } as BaseNode;
    const api = {
      getNodeByIdAsync: vi.fn<(id: string) => Promise<BaseNode | null>>(async id => {
        if (id.startsWith('I')) throw new Error('Figma rejected instance');
        return { findOne: () => child } as unknown as BaseNode;
      }),
    } as unknown as typeof figma;
    const state = { byIdRejected: false };
    const first = call('first');
    const second = call('second');
    expect(
      await withInstanceIdLookup(withPerfApi(api, first), state).getNodeByIdAsync(child.id),
    ).toBe(child);
    expect(
      await withInstanceIdLookup(withPerfApi(api, second), state).getNodeByIdAsync(child.id),
    ).toBe(child);
    expect(first.byId.count).toBe(2);
    expect(second.byId.count).toBe(1);
  });
  it('keeps dispatcher concurrency and write idempotency with scoped handlers', async () => {
    perfStats({ enabled: true });
    let resolve!: (node: BaseNode | null) => void;
    const pending = new Promise<BaseNode | null>(done => {
      resolve = done;
    });
    const node = { id: '1:2', name: 'before' } as BaseNode;
    const api = {
      getNodeByIdAsync: vi.fn<(id: string) => Promise<BaseNode | null>>(id =>
        id === 'slow' ? pending : Promise.resolve(node),
      ),
    } as unknown as typeof figma;
    const cache = createIdempotencyCache();
    const state = { byIdRejected: false };
    const handlers = createSandboxHandlers(api, cache, state);
    const invoke = (id: string, method: string, params: unknown) =>
      dispatchSandboxMessage({
        raw: createToolCall({ id, method, params }),
        handlers,
        editorType: 'figma',
        scopedHandlers: row => createSandboxHandlers(withPerfApi(api, row), cache, state),
      });
    const waiting = invoke('slow', 'get_node', { nodeId: 'slow' });
    await invoke('write1', 'rename_node', { nodeId: '1:2', name: 'after', requestId: 'same' });
    await invoke('write2', 'rename_node', {
      nodeId: '1:2',
      name: 'ignored replay',
      requestId: 'same',
    });
    expect(node.name).toBe('after');
    expect(perfStats({}).calls.map(row => row.id)).toEqual(['write2', 'write1']);
    resolve(null);
    await waiting;
    expect(perfStats({}).calls[0]).toMatchObject({ id: 'slow', byId: { count: 1 } });
  });
  it('times traversal and serialization without changing tree output', async () => {
    perfStats({ enabled: true });
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const node = {
      id: '1:1',
      type: 'RECTANGLE',
      name: 'shape',
      parent: null,
      x: 0,
      y: 0,
      get width() {
        now += 5;
        return 10;
      },
      height: 10,
    } as unknown as SceneNode;
    const row = call();
    expect(
      await collectMatches(
        [node],
        () => {
          now += 3;
          return true;
        },
        row,
      ),
    ).toEqual([node]);
    expect(row.traversalMs).toBe(3);
    const plain = await serializeTrees([node]);
    const measured = await serializeTrees([node], null, row);
    expect(measured).toEqual(plain);
    expect(row.serializationMs).toBeGreaterThanOrEqual(5);
  });
  it('records failure text without changing dispatcher replies', async () => {
    perfStats({ enabled: true });
    const outcome = await dispatchSandboxMessage({
      raw: createToolCall({ id: 'one', method: 'fail', params: {} }),
      handlers: {
        fail: () => {
          throw new Error('x'.repeat(150));
        },
      },
      editorType: 'figma',
    });
    expect(outcome.kind).toBe('reply');
    const row = perfStats({}).calls[0]!;
    expect(row.success).toBe(false);
    expect(row.error).toHaveLength(120);
  });
  it('attributes cooperative waits to the supplied call only', async () => {
    perfStats({ enabled: true });
    const row = call();
    await new TimeSlice(row).yield();
    expect(row.yieldCount).toBe(1);
    expect(row.yieldMs).toBeGreaterThanOrEqual(0);
  });
});
describe('load_page', () => {
  const page = (id: string, loadAsync = vi.fn<() => Promise<void>>(async () => {})) => ({
    id,
    name: id,
    loadAsync,
    children: [],
  });
  it('loads current page without looking up an unloaded node by id', async () => {
    const currentPage = page('current');
    const api = { currentPage, root: { children: [currentPage] } } as unknown as typeof figma;
    expect(await createLoadPageHandler(api)({})).toMatchObject({
      success: true,
      pages: [{ pageId: 'current', nodeCount: 0 }],
    });
  });
  it('limits sequential all-page loads and returns original failures with elapsed time', async () => {
    const first = page('first');
    const second = page(
      'second',
      vi.fn(async () => {
        throw new Error('Unable to establish connection to Figma after 10 seconds.');
      }),
    );
    const third = page('third');
    const api = {
      currentPage: first,
      root: { children: [first, second, third] },
    } as unknown as typeof figma;
    const handler = createLoadPageHandler(api);
    expect(await handler({ all: true, limit: 1 })).toMatchObject({
      remaining: 2,
      pages: [{ pageId: 'first' }],
    });
    expect(await handler({ all: true })).toMatchObject({
      success: false,
      remaining: 1,
      pages: [
        { pageId: 'first' },
        {
          pageId: 'second',
          error: 'Unable to establish connection to Figma after 10 seconds.',
          loadMs: expect.any(Number),
        },
      ],
    });
    expect(third.loadAsync).not.toHaveBeenCalled();
    await expect(handler({ all: true, pageId: 'first' })).rejects.toThrow('mutually exclusive');
    await expect(handler({ pageId: 'missing' })).rejects.toThrow('page not found');
  });
});

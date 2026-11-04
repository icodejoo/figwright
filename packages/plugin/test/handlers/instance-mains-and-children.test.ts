import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimeSlice } from '../../src/cooperative.js';
import { createGetInstanceMainsHandler } from '../../src/handlers/get-instance-mains.js';
import { createListChildrenHandler } from '../../src/handlers/list-children.js';
import { beginPerf, perfStats, withPerfApi } from '../../src/perf.js';
import * as serializer from '../../src/serializer.js';

afterEach(() => {
  vi.restoreAllMocks();
  perfStats({ enabled: false, reset: true });
});
const fixture = () => {
  const page = {
    id: 'page',
    type: 'PAGE',
    loadAsync: vi.fn<() => Promise<void>>(async () => {}),
    children: [] as unknown[],
  };
  const main = { id: 'main', name: 'Button', type: 'COMPONENT', parent: page as unknown };
  const make = (id: string, value: unknown = main) => ({
    id,
    name: id,
    type: 'INSTANCE',
    visible: true,
    getMainComponentAsync: vi.fn<() => Promise<unknown>>(async () => value),
  });
  const nested = make('I1');
  const first = { ...make('1'), children: [nested] };
  const second = make('2');
  page.children.push(first, second);
  const api = {
    currentPage: page,
    getNodeByIdAsync: vi.fn<(id: string) => Promise<unknown>>(async (id: string) =>
      id === 'page' ? page : id === '1' ? first : null,
    ),
  } as unknown as typeof figma;
  return { page, main, make, first, second, nested, api };
};

describe('get_instance_mains', () => {
  it('loads pages, excludes nested ids by default, aggregates and never serializes', async () => {
    const f = fixture();
    const flat = vi.spyOn(serializer, 'serializeFlatNodes');
    const trees = vi.spyOn(serializer, 'serializeTrees');
    expect(await createGetInstanceMainsHandler(f.api)({})).toMatchObject({
      counts: { instances: 2, orphan: 0, missing: 0 },
      distinctMains: [{ mainId: 'main', count: 2 }],
      complete: true,
      truncated: false,
    });
    expect(f.page.loadAsync).toHaveBeenCalledOnce();
    expect(f.nested.getMainComponentAsync).not.toHaveBeenCalled();
    expect(await createGetInstanceMainsHandler(f.api)({ scope: 'all' })).toMatchObject({
      counts: { instances: 3 },
    });
    expect(flat).not.toHaveBeenCalled();
    expect(trees).not.toHaveBeenCalled();
  });
  it('filters by main and component set names, handles detached ancestors and missing mains', async () => {
    const f = fixture();
    const set = { id: 'set', name: 'Controls', type: 'COMPONENT_SET', parent: null as unknown };
    f.main.parent = set;
    f.page.children.push(f.make('3', null));
    const handler = createGetInstanceMainsHandler(f.api);
    expect(await handler({ nameContains: 'CONTROL' })).toMatchObject({
      instances: [{ setId: 'set', orphan: true }, { orphan: true }],
      counts: { instances: 2, orphan: 2, missing: 0 },
    });
    expect(await handler({ nameContains: 'button' })).toMatchObject({ counts: { instances: 2 } });
    expect(await handler({ nameContains: 'absent' })).toMatchObject({
      instances: [],
      counts: { instances: 0 },
    });
    expect(await handler({})).toMatchObject({
      counts: { missing: 1 },
      instances: expect.arrayContaining([
        { instanceId: '3', mainId: null, orphan: false, missing: true },
      ]),
    });
    set.parent = f.page;
    expect(await handler({})).toMatchObject({ counts: { orphan: 0 } });
    f.main.parent = null;
    expect(await handler({})).toMatchObject({ counts: { orphan: 2 } });
  });
  it('sorts main aggregates, caps them at 500 and loads explicit pages before reading children', async () => {
    const f = fixture();
    f.page.children = Array.from({ length: 501 }, (_, index) =>
      f.make(String(index), { ...f.main, id: String(index) }),
    );
    f.page.children.push(f.make('repeat', { ...f.main, id: '500' }));
    let loaded = false;
    f.page.loadAsync.mockImplementation(async () => {
      loaded = true;
    });
    const children = f.page.children;
    Object.defineProperty(f.page, 'children', {
      get: () => {
        expect(loaded).toBe(true);
        return children;
      },
    });
    const result = (await createGetInstanceMainsHandler(f.api)({ root: 'page' })) as {
      distinctMains: unknown[];
    };
    expect(result).toMatchObject({
      complete: true,
      truncated: true,
      counts: { instances: 502 },
      distinctMains: expect.arrayContaining([
        { mainId: '500', mainName: 'Button', count: 2, orphan: false },
      ]),
    });
    expect(result.distinctMains).toHaveLength(500);
    expect(result.distinctMains[0]).toMatchObject({ mainId: '500', count: 2 });
  });
  it('limits work and returns partial results when the injected clock expires', async () => {
    const f = fixture();
    expect(await createGetInstanceMainsHandler(f.api)({ limit: 1 })).toMatchObject({
      truncated: true,
      complete: false,
      counts: { instances: 1 },
    });
    let time = 0;
    f.first.getMainComponentAsync.mockImplementation(async () => {
      time = 10;
      return f.main;
    });
    expect(
      await createGetInstanceMainsHandler(f.api, () => time)({ timeBudgetMs: 10 }),
    ).toMatchObject({ complete: false, counts: { instances: 2 } });
    for (const args of [{ limit: 20001 }, { timeBudgetMs: 100001 }, { scope: 'bad' }])
      // eslint-disable-next-line no-await-in-loop -- assert each invalid argument independently
      await expect(createGetInstanceMainsHandler(f.api)(args)).rejects.toThrow(
        'get_instance_mains:',
      );
  });

  it.each([
    { scope: 'topLevel' },
    { scope: 'all' },
    { nameContains: 'CONTROL' },
    { limit: 1 },
    { nameContains: 'button' },
    {},
  ])('preserves every result field for %j', async params => {
    const f = fixture();
    const set = { id: 'set', name: 'Controls', type: 'COMPONENT_SET', parent: null };
    f.main.parent = set;
    f.page.children.push(f.make('missing', null));
    const row = (id: string) => ({
      instanceId: id,
      mainId: 'main',
      mainName: 'Button',
      setId: 'set',
      setName: 'Controls',
      orphan: true,
    });
    const ids = params.scope === 'all' ? ['1', 'I1', '2'] : params.limit ? ['1'] : ['1', '2'];
    const missing = !params.nameContains && !params.limit;
    expect(await createGetInstanceMainsHandler(f.api)(params)).toEqual({
      instances: [
        ...ids.map(row),
        ...(missing ? [{ instanceId: 'missing', mainId: null, orphan: false, missing: true }] : []),
      ],
      distinctMains: [
        {
          mainId: 'main',
          mainName: 'Button',
          setName: 'Controls',
          count: ids.length,
          orphan: true,
        },
      ],
      counts: {
        instances: ids.length + Number(missing),
        orphan: ids.length,
        missing: Number(missing),
      },
      complete: !params.limit,
      truncated: Boolean(params.limit),
    });
  });

  it('bounds concurrent native lookups and preserves order when they finish in reverse', async () => {
    const f = fixture();
    let active = 0;
    let maximum = 0;
    let calls = 0;
    let pending: (() => void)[] = [];
    f.page.children = Array.from({ length: 130 }, (_, i) => ({
      id: String(i),
      type: 'INSTANCE',
      getMainComponentAsync: () => {
        calls += 1;
        active += 1;
        maximum = Math.max(maximum, active);
        return new Promise(resolve => {
          pending.push(() => {
            active -= 1;
            resolve(f.main);
          });
          if (pending.length === 64 || calls === 130) {
            const batch = pending;
            pending = [];
            queueMicrotask(() => {
              for (const done of batch.toReversed()) done();
            });
          }
        });
      },
    }));
    const result = await createGetInstanceMainsHandler(f.api)({});
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(64);
    expect(calls).toBe(130);
    expect(active).toBe(0);
    expect(result).toMatchObject({
      counts: { instances: 130 },
      complete: true,
      instances: Array.from({ length: 130 }, (_, i) =>
        expect.objectContaining({ instanceId: String(i) }),
      ),
    });
  });

  it('retains completed batches and the entire in-flight batch at budget expiry', async () => {
    const f = fixture();
    let time = 0;
    let calls = 0;
    const nodes = Array.from({ length: 150 }, (_, i) => {
      const node = f.make(String(i));
      node.getMainComponentAsync.mockImplementation(async () => {
        calls += 1;
        if (calls === 65) time = 10;
        return f.main;
      });
      return node;
    });
    f.page.children = nodes;
    expect(
      await createGetInstanceMainsHandler(f.api, () => time)({ timeBudgetMs: 10 }),
    ).toMatchObject({
      complete: false,
      truncated: false,
      counts: { instances: 128 },
      distinctMains: [{ mainId: 'main', count: 128 }],
      instances: Array.from({ length: 128 }, (_, i) =>
        expect.objectContaining({ instanceId: String(i) }),
      ),
    });
    expect(calls).toBe(128);
    expect(nodes[128]!.getMainComponentAsync).not.toHaveBeenCalled();
  });

  it('walks a shared main ancestor chain only once across batches and resets per request', async () => {
    const f = fixture();
    const parent = vi.fn<() => null>(() => null);
    f.main.parent = {
      id: 'detached',
      type: 'FRAME',
      get parent() {
        return parent();
      },
    };
    f.page.children = Array.from({ length: 130 }, (_, i) => f.make(String(i)));
    expect(await createGetInstanceMainsHandler(f.api)({})).toMatchObject({
      counts: { orphan: 130 },
    });
    expect(parent).toHaveBeenCalledOnce();
    await createGetInstanceMainsHandler(f.api)({});
    expect(parent).toHaveBeenCalledTimes(2);
  });

  it('skips instance subtrees at topLevel and only calls the native API on instances', async () => {
    const f = fixture();
    const children = vi.fn<() => (typeof f.nested)[]>(() => [f.nested]);
    Object.defineProperty(f.first, 'children', { get: children });
    const unrelatedLookup = vi.fn<() => never>(() => {
      throw new Error('not an instance');
    });
    f.page.children.push({
      id: 'frame',
      type: 'FRAME',
      children: [f.second],
      getMainComponentAsync: unrelatedLookup,
    });
    await createGetInstanceMainsHandler(f.api)({ scope: 'topLevel' });
    expect(children).not.toHaveBeenCalled();
    expect(f.nested.getMainComponentAsync).not.toHaveBeenCalled();
    expect(unrelatedLookup).not.toHaveBeenCalled();
    await createGetInstanceMainsHandler(f.api)({ scope: 'all' });
    expect(children).toHaveBeenCalledOnce();
    expect(f.nested.getMainComponentAsync).toHaveBeenCalledOnce();
  });

  it('reports timings only when requested and attributes separate perf stages', async () => {
    const f = fixture();
    let time = 0;
    Object.defineProperty(f.first, 'type', {
      get: () => {
        time += 1;
        return 'INSTANCE';
      },
    });
    f.first.getMainComponentAsync.mockImplementation(async () => {
      time += 7;
      return f.main;
    });
    const handler = createGetInstanceMainsHandler(f.api, () => time);
    expect(await handler({})).not.toHaveProperty('timings');
    expect(await handler({ includeTimings: false })).not.toHaveProperty('timings');
    perfStats({ enabled: true });
    const call = beginPerf('mains', 'get_instance_mains')!;
    const result = await createGetInstanceMainsHandler(
      withPerfApi(f.api, call),
      () => time,
    )({ includeTimings: true });
    expect(result).toHaveProperty('timings', { traversalMs: 4, lookupMs: 7, concurrency: 2 });
    expect(call).toMatchObject({ traversalMs: 4, mainLookupMs: 7 });
    expect(await handler({ includeTimings: true })).toHaveProperty('timings', {
      traversalMs: 4,
      lookupMs: 7,
      concurrency: 2,
    });
  });

  it('does not start collected lookups after traversal exhausts the budget', async () => {
    const f = fixture();
    let time = 0;
    vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(true);
    vi.spyOn(TimeSlice.prototype, 'yield').mockImplementation(async () => {
      time = 10;
    });
    expect(await createGetInstanceMainsHandler(f.api, () => time)({ timeBudgetMs: 10 })).toEqual({
      instances: [],
      distinctMains: [],
      counts: { instances: 0, orphan: 0, missing: 0 },
      complete: false,
      truncated: false,
    });
    expect(f.first.getMainComponentAsync).not.toHaveBeenCalled();
    expect(f.second.getMainComponentAsync).not.toHaveBeenCalled();
  });

  it('yields cooperatively while traversing nodes without instances', async () => {
    const f = fixture();
    f.page.children = Array.from({ length: 100 }, (_, i) => ({ id: String(i), type: 'RECTANGLE' }));
    vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(true);
    const yielding = vi.spyOn(TimeSlice.prototype, 'yield').mockResolvedValue();
    expect(await createGetInstanceMainsHandler(f.api)({})).toMatchObject({
      complete: true,
      counts: { instances: 0 },
    });
    expect(yielding).toHaveBeenCalledTimes(99);
  });
});

describe('list_children', () => {
  it('reads one level with original indices, handles pages, filters and empty leaves', async () => {
    const f = fixture();
    const childrenRead = vi.fn<() => never>(() => {
      throw new Error('recursive access');
    });
    Object.defineProperty(f.nested, 'children', { get: childrenRead });
    const flat = vi.spyOn(serializer, 'serializeFlatNodes');
    const trees = vi.spyOn(serializer, 'serializeTrees');
    const handler = createListChildrenHandler(f.api);
    expect(await handler({ nodeId: '1' })).toEqual({
      nodeId: '1',
      children: [{ id: 'I1', name: 'I1', type: 'INSTANCE', visible: true, index: 0 }],
      count: 1,
    });
    expect(childrenRead).not.toHaveBeenCalled();
    expect(await handler({ nodeId: 'page', types: ['TEXT'] })).toMatchObject({
      children: [],
      count: 0,
    });
    expect(f.page.loadAsync).toHaveBeenCalledOnce();
    f.page.children = [f.second, { id: 'text', name: 'Text', type: 'TEXT', visible: false }];
    expect(await handler({ nodeId: 'page', types: ['TEXT'] })).toMatchObject({
      children: [{ id: 'text', index: 1, visible: false }],
      count: 1,
    });
    f.first.children = [];
    expect(await handler({ nodeId: '1' })).toMatchObject({ children: [], count: 0 });
    await expect(handler({ nodeId: 'missing' })).rejects.toThrow(
      'list_children: node not found: missing',
    );
    expect(flat).not.toHaveBeenCalled();
    expect(trees).not.toHaveBeenCalled();
  });
  it('caps only above 5000 and retains the total matching count', async () => {
    const f = fixture();
    f.page.children = Array.from({ length: 5001 }, (_, i) => f.make(String(i)));
    const result = (await createListChildrenHandler(f.api)({ nodeId: 'page' })) as {
      children: unknown[];
    };
    expect(result).toMatchObject({ count: 5001, truncated: true, note: expect.any(String) });
    expect(result.children).toHaveLength(5000);
  });
});

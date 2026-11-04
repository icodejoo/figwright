import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGetInstanceMainsHandler } from '../../src/handlers/get-instance-mains.js';
import { createListChildrenHandler } from '../../src/handlers/list-children.js';
import * as serializer from '../../src/serializer.js';

afterEach(() => vi.restoreAllMocks());
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
    ).toMatchObject({ complete: false, counts: { instances: 1 } });
    for (const args of [{ limit: 20001 }, { timeBudgetMs: 100001 }, { scope: 'bad' }])
      await expect(createGetInstanceMainsHandler(f.api)(args)).rejects.toThrow(
        'get_instance_mains:',
      );
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

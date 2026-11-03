import { describe, it, expect, vi } from 'vitest';

import { createGetPublishStatusHandler } from '../../src/handlers/get-publish-status.js';
const mock = <T extends (...args: never[]) => unknown>(implementation: T) =>
  vi.fn<T>(implementation);
const setup = () => {
  const make = (id: string, status = 'CURRENT', extra = {}) => ({
    id,
    name: id,
    key: id,
    remote: false,
    getPublishStatusAsync: mock(async () => status),
    ...extra,
  });
  const collection = make('collection', 'UNPUBLISHED', { hiddenFromPublishing: true });
  const variable = make('variable', 'CHANGED', { hiddenFromPublishing: false });
  const remote = make('remote', 'CURRENT', { remote: true });
  const component = make('component', 'CURRENT', { type: 'COMPONENT' }),
    set = make('set', 'CHANGED', { type: 'COMPONENT_SET', children: [component] });
  const styles = ['PAINT', 'TEXT', 'EFFECT', 'GRID'].map((type, i) =>
    make(type, i % 2 ? 'CHANGED' : 'CURRENT', { type }),
  );
  const page = { id: 'page', type: 'PAGE', loadAsync: mock(async () => {}), children: [set] };
  const api = {
    currentPage: page,
    getNodeByIdAsync: mock(async () => set),
    variables: {
      getLocalVariableCollectionsAsync: mock(async () => [collection]),
      getLocalVariablesAsync: mock(async () => [variable, remote]),
      getVariableByIdAsync: mock(async () => remote),
    },
    getLocalPaintStylesAsync: mock(async () => [styles[0]]),
    getLocalTextStylesAsync: mock(async () => [styles[1]]),
    getLocalEffectStylesAsync: mock(async () => [styles[2]]),
    getLocalGridStylesAsync: mock(async () => [styles[3]]),
  } as unknown as typeof figma;
  return { api, remote, page };
};
describe('get_publish_status', () => {
  it('counts every kind, four style categories, and skips remote objects', async () => {
    const f = setup(),
      h = createGetPublishStatusHandler(f.api);
    expect(await h({})).toMatchObject({
      kind: 'VARIABLE_COLLECTION',
      items: [{ hiddenFromPublishing: true }],
      counts: { UNPUBLISHED: 1 },
      complete: true,
    });
    expect(await h({ kind: 'ALL_LOCAL' })).toMatchObject({
      counts: { UNPUBLISHED: 1, CURRENT: 3, CHANGED: 4 },
      countsByKind: {
        VARIABLE_COLLECTION: { UNPUBLISHED: 1 },
        VARIABLE: { CHANGED: 1 },
        STYLE: { CURRENT: 2, CHANGED: 2 },
        COMPONENT: { CURRENT: 1 },
        COMPONENT_SET: { CHANGED: 1 },
      },
      skippedRemote: 1,
    });
    expect(f.remote.getPublishStatusAsync).not.toHaveBeenCalled();
    for (const kind of ['VARIABLE', 'STYLE', 'COMPONENT', 'COMPONENT_SET'])
      expect(await h({ kind })).toMatchObject({ kind, complete: true });
  });
  it('filters before limiting, counts before filtering, and scopes component ids', async () => {
    const f = setup(),
      h = createGetPublishStatusHandler(f.api);
    expect(await h({ kind: 'STYLE', statuses: ['CHANGED'], limit: 1 })).toMatchObject({
      items: [{ id: 'TEXT' }],
      counts: { CURRENT: 2, CHANGED: 2 },
      truncated: true,
    });
    expect(await h({ kind: 'COMPONENT', root: 'set', ids: ['component'] })).toMatchObject({
      items: [{ id: 'component' }],
    });
    expect(await h({ kind: 'COMPONENT', ids: ['absent'] })).toMatchObject({ items: [] });
    expect(await h({ kind: 'VARIABLE', ids: ['remote'] })).toMatchObject({
      items: [],
      skippedRemote: 1,
    });
  });
  it('rejects root for non-component kinds and returns partial counts with an injected clock', async () => {
    const f = setup();
    for (const kind of ['VARIABLE_COLLECTION', 'VARIABLE', 'STYLE', 'ALL_LOCAL'])
      await expect(createGetPublishStatusHandler(f.api)({ kind, root: 'x' })).rejects.toThrow(
        'root',
      );
    let n = 0;
    expect(
      await createGetPublishStatusHandler(f.api, () => (n++ === 0 ? 0 : 100001))({
        kind: 'ALL_LOCAL',
      }),
    ).toMatchObject({ complete: false, items: [] });
    let clock = 0;
    f.api.getLocalPaintStylesAsync = mock(async () => {
      clock = 100001;
      return [];
    });
    expect(
      await createGetPublishStatusHandler(f.api, () => clock)({ kind: 'STYLE' }),
    ).toMatchObject({ complete: false });
  });
  it('returns completed component reads when the traversal deadline expires', async () => {
    const f = setup();
    let clock = 0;
    const first = {
      id: 'first',
      type: 'COMPONENT',
      name: 'first',
      remote: false,
      key: 'k',
      getPublishStatusAsync: mock(async () => {
        clock = 100001;
        return 'CHANGED';
      }),
    };
    f.page.children.push(first as unknown as (typeof f.page.children)[number]);
    // Process the first component, then leave a second component pending.
    f.page.children.reverse();
    expect(
      await createGetPublishStatusHandler(f.api, () => clock)({ kind: 'COMPONENT' }),
    ).toMatchObject({
      items: [{ id: 'first', status: 'CHANGED' }],
      counts: { CHANGED: 1 },
      complete: false,
    });
  });
});

describe('publish status failure isolation', () => {
  it('bounds object failures, truncates bare errors and continues to healthy objects', async () => {
    const f = setup();
    f.api.variables.getLocalVariablesAsync = mock(
      async () =>
        [
          ...Array.from({ length: 25 }, (_, i) => ({
            id: `bad${i}`,
            remote: false,
            getPublishStatusAsync: async () => {
              throw 'x'.repeat(200);
            },
          })),
          { id: 'good', remote: false, getPublishStatusAsync: async () => 'CURRENT' },
        ] as unknown as Variable[],
    );
    const result = (await createGetPublishStatusHandler(f.api)({ kind: 'VARIABLE' })) as {
      failed: unknown[];
    };
    expect(result).toMatchObject({
      complete: true,
      failedCount: 25,
      counts: { CURRENT: 1 },
      failed: expect.arrayContaining([{ id: 'bad0', error: 'x'.repeat(120) }]),
    });
    expect(result.failed).toHaveLength(20);
  });
  it('reports absent ids separately from remote and failed lookups', async () => {
    const f = setup();
    f.api.variables.getVariableByIdAsync = mock(async (id: string) => {
      if (id === 'bad') throw 'lookup failed';
      return id === 'remote' ? (f.remote as unknown as Variable) : null;
    });
    expect(
      await createGetPublishStatusHandler(f.api)({
        kind: 'VARIABLE',
        ids: ['remote', 'bad', 'absent'],
      }),
    ).toMatchObject({
      notFound: ['absent'],
      failed: [{ id: 'bad', error: 'lookup failed' }],
      skippedRemote: 1,
    });
  });
});

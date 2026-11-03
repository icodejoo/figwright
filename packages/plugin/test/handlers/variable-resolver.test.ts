import { describe, expect, it, vi } from 'vitest';

import { createBindVariablesByValueHandler } from '../../src/handlers/bind-variables-by-value.js';
import { createGetPublishStatusHandler } from '../../src/handlers/get-publish-status.js';
import { createRebindVariablesHandler } from '../../src/handlers/rebind-variables.js';
import { createScanVariableBindingsHandler } from '../../src/handlers/scan-variable-bindings.js';
import { createVariableResolver } from '../../src/handlers/variable-bindings.js';
import { alias, fixture } from './variable-bindings-fixture.js';

const setup = (remote: boolean) => {
  const f = fixture();
  const collection = { id: 'colors', name: 'Colors', defaultModeId: 'm' } as VariableCollection;
  const variables = ['old', 'new'].map(id =>
    Object.assign(f.variables.get(id)!, {
      valuesByMode: { m: id === 'old' ? alias('new') : { r: 1, g: 0, b: 0, a: 1 } },
      remote,
      getPublishStatusAsync: vi.fn<() => Promise<string>>(async () => 'CURRENT'),
    }),
  ) as unknown as Variable[];
  f.api.variables.getLocalVariablesAsync = vi.fn<() => Promise<Variable[]>>(async () =>
    remote ? [] : variables,
  );
  f.api.variables.getLocalVariableCollectionsAsync = vi.fn<() => Promise<VariableCollection[]>>(
    async () => (remote ? [] : [collection]),
  );
  f.api.variables.getVariableByIdAsync = vi.fn<(id: string) => Promise<Variable | null>>(
    async (id: string) => {
      if (!remote && variables.some(v => v.id === id))
        throw 'Unable to establish connection to Figma after 10 seconds';
      return variables.find(v => v.id === id) ?? null;
    },
  );
  f.api.variables.getVariableCollectionByIdAsync = vi.fn<
    (id: string) => Promise<VariableCollection | null>
  >(async (id: string) => {
    if (!remote && id === collection.id)
      throw 'Unable to establish connection to Figma after 10 seconds';
    return id === collection.id ? collection : null;
  });
  return { ...f, collection, localVariables: variables };
};

describe('local-first variable resolution', () => {
  it.each([false, true])(
    'rebinds using local lists or remote fallback, remote=%s',
    async remote => {
      const f = setup(remote);
      const h = createRebindVariablesHandler(f.api);
      expect(await h({ mapping: [{ from: 'old', to: 'new' }], dryRun: false })).toMatchObject({
        complete: true,
        changed: { fills: 1 },
        failedCount: 0,
      });
      expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledExactlyOnceWith();
      expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(remote ? 2 : 0);
      // A reused handler must see edits made between tool calls.
      f.localVariables[1]!.name = 'Renamed';
      await h({ mapping: [{ from: 'new', to: 'old' }] });
      expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
    },
  );

  it.each([false, true])('binds values through alias chains, remote=%s', async remote => {
    const f = setup(remote);
    f.nodes[0]!.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    expect(
      await createBindVariablesByValueHandler(f.api)({
        variableIds: ['old'],
        dryRun: false,
      }),
    ).toMatchObject({ complete: true, changed: { fills: 1 }, failedCount: 0 });
    expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getLocalVariableCollectionsAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(remote ? 2 : 0);
    expect(f.api.variables.getVariableCollectionByIdAsync).toHaveBeenCalledTimes(remote ? 1 : 0);
  });

  it.each([false, true])('scans names and collection filters, remote=%s', async remote => {
    const f = setup(remote);
    expect(
      await createScanVariableBindingsHandler(f.api)({ collectionIds: ['colors'] }),
    ).toMatchObject({
      complete: true,
      bindings: [{ variableId: 'old', name: 'old', collectionName: 'Colors', count: 2 }],
    });
    expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getLocalVariableCollectionsAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(remote ? 2 : 1);
    expect(f.api.variables.getVariableCollectionByIdAsync).toHaveBeenCalledTimes(remote ? 1 : 0);
  });

  it.each(['VARIABLE', 'VARIABLE_COLLECTION'])(
    'reads publish status by local %s ids',
    async kind => {
      const f = setup(false);
      Object.assign(f.collection, {
        remote: false,
        getPublishStatusAsync: vi.fn<() => Promise<string>>(async () => 'CURRENT'),
      });
      const ids = kind === 'VARIABLE' ? ['old', 'new'] : ['colors'];
      expect(await createGetPublishStatusHandler(f.api)({ kind, ids })).toMatchObject({
        complete: true,
        counts: { CURRENT: ids.length },
        failedCount: 0,
        notFound: [],
      });
      expect(f.api.variables.getVariableByIdAsync).not.toHaveBeenCalled();
      expect(f.api.variables.getVariableCollectionByIdAsync).not.toHaveBeenCalled();
      expect(
        kind === 'VARIABLE'
          ? f.api.variables.getLocalVariablesAsync
          : f.api.variables.getLocalVariableCollectionsAsync,
      ).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it('resolves remote publish ids and preserves remote skipping', async () => {
    const f = setup(true);
    expect(
      await createGetPublishStatusHandler(f.api)({ kind: 'VARIABLE', ids: ['old', 'new'] }),
    ).toMatchObject({ skippedRemote: 2, failedCount: 0, notFound: [] });
    expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(2);
  });

  it('lazily loads once under concurrency and caches fallback objects and nulls', async () => {
    const f = setup(true);
    const resolver = createVariableResolver(f.api);
    expect(f.api.variables.getLocalVariablesAsync).not.toHaveBeenCalled();
    expect(f.api.variables.getLocalVariableCollectionsAsync).not.toHaveBeenCalled();
    expect(await Promise.all(['old', 'old', 'missing', 'missing'].map(resolver.resolve))).toEqual([
      f.localVariables[0],
      f.localVariables[0],
      null,
      null,
    ]);
    expect(
      await Promise.all(['colors', 'colors', 'missing', 'missing'].map(resolver.resolveCollection)),
    ).toEqual([f.collection, f.collection, null, null]);
    expect(await resolver.resolve('missing')).toBeNull();
    expect(await resolver.resolveCollection('missing')).toBeNull();
    expect(f.api.variables.getLocalVariablesAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getLocalVariableCollectionsAsync).toHaveBeenCalledExactlyOnceWith();
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(2);
    expect(f.api.variables.getVariableCollectionByIdAsync).toHaveBeenCalledTimes(2);
  });
});

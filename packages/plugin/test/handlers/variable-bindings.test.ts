import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimeSlice } from '../../src/cooperative.js';
import { createBindVariablesByValueHandler } from '../../src/handlers/bind-variables-by-value.js';
import { createRebindVariablesHandler } from '../../src/handlers/rebind-variables.js';
import { createScanVariableBindingsHandler } from '../../src/handlers/scan-variable-bindings.js';
import { readBindings } from '../../src/handlers/variable-bindings.js';
import { beginPerf, bindPerf, perfStats } from '../../src/perf.js';
import { alias } from './variable-bindings-fixture.js';
import { fixture } from './variable-bindings-fixture.js';

afterEach(() => {
  vi.restoreAllMocks();
  perfStats({ enabled: false, reset: true });
});
describe('binding traversal', () => {
  it.each([false, true])(
    'uses cooperative slices, stack traversal and optional perf recording, write=%s',
    async write => {
      const f = fixture();
      const root = f.nodes[0]!;
      Object.assign(root, { children: [f.nodes[1], f.nodes[2]] });
      const due = vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(true);
      const yieldSpy = vi.spyOn(TimeSlice.prototype, 'yield').mockResolvedValue();
      perfStats({ enabled: true });
      const call = beginPerf('test', write ? 'rebind_variables' : 'scan_variable_bindings')!;
      bindPerf(f.api, call);
      let clock = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => clock++);
      const result = write
        ? await createRebindVariablesHandler(f.api)({
            root: root.id,
            mapping: [{ from: 'old', to: 'new' }],
            dryRun: false,
            includeInstanceSublayers: true,
          })
        : await createScanVariableBindingsHandler(f.api)({ root: root.id });
      expect(result).toMatchObject({ root: root.id, visited: 3, complete: true });
      expect(due).toHaveBeenCalledTimes(2);
      expect(yieldSpy).toHaveBeenCalledTimes(2);
      expect(call.traversalMs).toBeGreaterThan(0);
      expect(call.serializationMs).toBe(0);
      expect(f.page.loadAsync).toHaveBeenCalledTimes(0);
    },
  );
  it('does not read children recursively and accepts very deep trees', async () => {
    const f = fixture();
    let child = f.nodes[0]!;
    for (let i = 0; i < 12000; i++) {
      const parent = f.makeNode(`deep${i}`, []);
      Object.assign(parent, { children: [child] });
      child = parent;
    }
    f.page.children.splice(0, f.page.children.length, child);
    vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(false);
    expect(
      await createScanVariableBindingsHandler(f.api)({ variableIds: ['old'], sampleLimit: 0 }),
    ).toMatchObject({
      visited: 12001,
      complete: true,
      bindings: [{ variableId: 'old', count: 1, samples: [] }],
    });
  });
});

describe('binding safety regressions', () => {
  it('reads componentProperties object aliases', () => {
    const f = fixture();
    f.nodes[0]!.boundVariables = { componentProperties: { 'Title#1': alias() } };
    expect(readBindings(f.api, f.nodes[0]! as unknown as SceneNode)).toContainEqual(
      expect.objectContaining({ key: 'componentProperties', variableId: 'old' }),
    );
  });
  it('continues after removed nodes and throwing child getters', async () => {
    const f = fixture();
    Object.defineProperty(f.nodes[0], 'children', {
      get: () => {
        throw 'deleted during traversal';
      },
    });
    Object.assign(f.nodes[1]!, { removed: true });
    expect(await createScanVariableBindingsHandler(f.api)({})).toMatchObject({
      complete: true,
      bindings: expect.arrayContaining([
        expect.objectContaining({ variableId: 'other', count: 1 }),
      ]),
    });
  });
  it.each(['rebind', 'byValue'])(
    '%s processes only outermost instance override fields and never descends by default',
    async tool => {
      const f = fixture();
      const root = f.nodes[0]!;
      const child = f.nodes[1]!;
      const overrides = [
        { id: root.id, overriddenFields: ['strokes'] },
        { id: child.id, overriddenFields: ['fills'] },
      ];
      Object.assign(root, { type: 'INSTANCE', strokes: root.fills, children: [child], overrides });
      Object.assign(child, { parent: root });
      if (tool === 'byValue') {
        root.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
        child.fills = root.fills;
        Object.assign(root, { strokes: root.fills });
        const get = f.api.variables.getVariableByIdAsync;
        f.api.variables.getVariableByIdAsync = vi.fn<(id: string) => Promise<Variable>>(
          async id =>
            ({ ...(await get(id)), valuesByMode: { m: { r: 1, g: 0, b: 0 } } }) as Variable,
        );
        f.api.variables.getVariableCollectionByIdAsync = vi.fn<() => Promise<VariableCollection>>(
          async () => ({ id: 'colors', defaultModeId: 'm' }) as VariableCollection,
        );
      }
      f.writes.mockClear();
      const h =
        tool === 'rebind'
          ? createRebindVariablesHandler(f.api)
          : createBindVariablesByValueHandler(f.api);
      const args =
        tool === 'rebind' ? { mapping: [{ from: 'old', to: 'new' }] } : { variableIds: ['old'] };
      expect(await h({ ...args, root: root.id })).toMatchObject({
        skippedInstances: 1,
        matched: { fills: 0, strokes: 1 },
      });
      expect(
        await h({ ...args, root: root.id, includeInstanceSublayers: true, dryRun: false }),
      ).toMatchObject({ skippedInstances: 0, changed: { fills: 1, strokes: 1 } });
      expect(f.writes).not.toHaveBeenCalledWith(root.id, 'fills');
    },
  );
  it.each(['fills', 'strokes', 'effects'] as const)(
    'rebind preserves %s string style links',
    async group => {
      const f = fixture();
      Object.assign(f.nodes[0]!, {
        [group]:
          group === 'effects'
            ? [{ type: 'DROP_SHADOW', boundVariables: { color: alias() } }]
            : f.nodes[0]!.fills,
        [{ fills: 'fillStyleId', strokes: 'strokeStyleId', effects: 'effectStyleId' }[group]]:
          'style',
      });
      expect(
        await createRebindVariablesHandler(f.api)({
          root: '1:1',
          mapping: [{ from: 'old', to: 'new' }],
          fields: [group],
          dryRun: false,
        }),
      ).toMatchObject({ skippedStyled: 1, changed: { [group]: 0 } });
      expect(f.bind).not.toHaveBeenCalled();
    },
  );
});

describe('instance traversal boundaries', () => {
  it.each(['rebind', 'byValue'])(
    '%s never reads children with default instance traversal',
    async tool => {
      const f = fixture();
      const root = f.nodes[0]!;
      Object.assign(root, { type: 'INSTANCE', overrides: [] });
      const children = vi.fn<() => never>(() => {
        throw 'must not read children';
      });
      Object.defineProperty(root, 'children', { get: children });
      if (tool === 'byValue') {
        const get = f.api.variables.getVariableByIdAsync;
        f.api.variables.getVariableByIdAsync = vi.fn<(id: string) => Promise<Variable>>(
          async id =>
            ({ ...(await get(id)), valuesByMode: { m: { r: 1, g: 0, b: 0 } } }) as Variable,
        );
        f.api.variables.getVariableCollectionByIdAsync = vi.fn<() => Promise<VariableCollection>>(
          async () => ({ id: 'colors', defaultModeId: 'm' }) as VariableCollection,
        );
      }
      const h =
        tool === 'rebind'
          ? createRebindVariablesHandler(f.api)
          : createBindVariablesByValueHandler(f.api);
      expect(
        await h({
          root: root.id,
          mapping: [{ from: 'old', to: 'new' }],
          variableIds: ['old'],
          dryRun: false,
        }),
      ).toMatchObject({ skippedInstances: 1, changed: { fills: 0 } });
      expect(children).not.toHaveBeenCalled();
    },
  );
  it.each(['rebind', 'byValue'])(
    '%s obeys outer overrides on nested instances and individual scalars',
    async tool => {
      const f = fixture();
      const root = f.nodes[0]!;
      const inner = f.nodes[1]!;
      Object.assign(root, {
        type: 'INSTANCE',
        overrides: [
          { id: root.id, overriddenFields: ['paddingLeft'] },
          { id: inner.id, overriddenFields: [] },
        ],
        children: [inner],
        layoutMode: 'HORIZONTAL',
        paddingLeft: 8,
        paddingRight: 8,
      });
      Object.assign(inner, {
        type: 'INSTANCE',
        parent: root,
        overrides: [{ id: inner.id, overriddenFields: ['fills'] }],
      });
      root.boundVariables =
        tool === 'rebind' ? { paddingLeft: alias('float'), paddingRight: alias('float') } : {};
      if (tool === 'byValue') {
        root.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
        inner.fills = root.fills;
        const get = f.api.variables.getVariableByIdAsync;
        f.api.variables.getVariableByIdAsync = vi.fn<(id: string) => Promise<Variable>>(
          async id =>
            ({
              ...(await get(id)),
              valuesByMode: { m: id === 'float' ? 8 : { r: 1, g: 0, b: 0 } },
            }) as Variable,
        );
        f.api.variables.getVariableCollectionByIdAsync = vi.fn<() => Promise<VariableCollection>>(
          async () => ({ id: 'colors', defaultModeId: 'm' }) as VariableCollection,
        );
      }
      f.writes.mockClear();
      const h =
        tool === 'rebind'
          ? createRebindVariablesHandler(f.api)
          : createBindVariablesByValueHandler(f.api);
      expect(
        await h({
          root: root.id,
          includeInstanceSublayers: true,
          mapping: [
            { from: 'old', to: 'new' },
            { from: 'float', to: 'floatNew' },
          ],
          variableIds: ['old', 'float'],
          fields: ['fills', 'scalars'],
          dryRun: false,
        }),
      ).toMatchObject({ changed: { fills: 0, scalars: 1 } });
      expect(f.writes).toHaveBeenCalledExactlyOnceWith(root.id, 'paddingLeft');
    },
  );
});

import { describe, it, expect, vi } from 'vitest';

import { NON_BATCHABLE } from '../../src/handlers/batch.js';
import { createBindVariablesByValueHandler } from '../../src/handlers/bind-variables-by-value.js';
import { fixture, alias } from './variable-bindings-fixture.js';
const mock = <T extends (...args: never[]) => unknown>(implementation: T) =>
  vi.fn<T>(implementation);
const red = { r: 1, g: 0, b: 0, a: 1 };
const setup = () => {
  const f = fixture();
  for (const node of f.nodes) node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
  f.writes.mockClear();
  const values = new Map<string, unknown>([
    ['old', red],
    ['new', red],
    ['float', 8],
  ]);
  const original = f.api.variables.getVariableByIdAsync;
  f.api.variables.getVariableByIdAsync = mock(async (id: string) => {
    const v = await original(id);
    return v ? ({ ...v, valuesByMode: { m: values.get(id) } } as Variable) : null;
  });
  f.api.variables.getVariableCollectionByIdAsync = mock(
    async () => ({ id: 'colors', name: 'colors', defaultModeId: 'm' }) as VariableCollection,
  );
  return { ...f, values, h: createBindVariablesByValueHandler(f.api) };
};
describe('bind_variables_by_value', () => {
  it('refuses batching because subtree changes lack an inverse', () => {
    expect(NON_BATCHABLE.bind_variables_by_value).toContain('inverse');
  });
  it('defaults to zero-write dryRun, skips nested, then writes and is idempotent', async () => {
    const f = setup();
    expect(await f.h({ variableIds: ['old'] })).toMatchObject({
      dryRun: true,
      matched: { fills: 2 },
      changed: { fills: 0 },
      skippedInstances: 1,
    });
    expect(f.bind).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
    expect(
      await f.h({ variableIds: ['old'], dryRun: false, includeInstanceSublayers: true }),
    ).toMatchObject({ changed: { fills: 3 }, perVariable: [{ count: 3 }] });
    expect(
      await f.h({ variableIds: ['old'], dryRun: false, includeInstanceSublayers: true }),
    ).toMatchObject({ matched: { fills: 0 }, changed: { fills: 0 } });
  });
  it('compares all color channels within tolerance including alpha', async () => {
    const f = setup();
    f.values.set('old', { ...red, r: 0.995, a: 0.5 });
    f.nodes[0]!.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.5 }];
    expect(await f.h({ variableIds: ['old'] })).toMatchObject({ matched: { fills: 0 } });
    expect(await f.h({ variableIds: ['old'], tolerance: 0.006 })).toMatchObject({
      matched: { fills: 1 },
    });
    f.values.set('old', red);
    expect(await f.h({ variableIds: ['old'] })).toMatchObject({
      matched: { fills: 1 },
      skippedAlpha: 1,
    });
  });
  it('resolves alias chains and refuses cycles, missing modes and invalid types before writes', async () => {
    const f = setup();
    f.values.set('old', alias('new'));
    expect(await f.h({ variableIds: ['old'] })).toMatchObject({ matched: { fills: 2 } });
    f.values.set('new', alias('old'));
    await expect(f.h({ variableIds: ['old'], dryRun: false })).rejects.toThrow('cycle');
    expect(f.writes).not.toHaveBeenCalled();

    f.values.set('old', alias('float'));
    await expect(f.h({ variableIds: ['old'] })).rejects.toThrow('type mismatch');
  });
  it('skips ambiguous values or chooses the first input variable', async () => {
    const f = setup();
    expect(await f.h({ variableIds: ['new', 'old'] })).toMatchObject({
      ambiguous: 2,
      matched: { fills: 0 },
    });
    expect(
      await f.h({ variableIds: ['new', 'old'], onAmbiguous: 'first', dryRun: false }),
    ).toMatchObject({
      ambiguous: 2,
      changed: { fills: 2 },
      perVariable: [
        { variableId: 'new', count: 2 },
        { variableId: 'old', count: 0 },
      ],
    });
  });
  it('leaves existing color and scalar bindings untouched and matches scalars exactly', async () => {
    const f = setup();
    f.nodes[0]!.fills = [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: alias('new') } },
    ];
    Object.assign(f.nodes[0]!, {
      layoutMode: 'HORIZONTAL',
      paddingLeft: 8,
      paddingRight: 8,
      cornerRadius: 8,
      topLeftRadius: 8,
      topRightRadius: 8,
      bottomLeftRadius: 8,
      bottomRightRadius: 8,
    });
    f.nodes[0]!.boundVariables = { paddingLeft: alias('float') };
    expect(
      await f.h({
        root: '1:1',
        variableIds: ['old', 'float'],
        fields: ['fills', 'scalars'],
        dryRun: false,
      }),
    ).toMatchObject({ matched: { fills: 0, scalars: 5 }, changed: { scalars: 5 } });
    expect(
      await f.h({ root: '1:1', variableIds: ['float'], fields: ['scalars'], dryRun: false }),
    ).toMatchObject({ matched: { scalars: 0 } });
    expect(f.nodes[0]!.setBoundVariable).not.toHaveBeenCalledWith(
      'cornerRadius',
      expect.anything(),
    );
  });
  it('binds effects colors and numbers, preserves existing effect fields', async () => {
    const f = setup();
    Object.assign(f.nodes[0]!, {
      effects: [
        {
          type: 'DROP_SHADOW',
          color: red,
          radius: 8,
          spread: 8,
          offset: { x: 8, y: 8 },
          boundVariables: { spread: alias('float') },
        },
      ],
    });
    expect(
      await f.h({ root: '1:1', variableIds: ['old', 'float'], fields: ['effects'], dryRun: false }),
    ).toMatchObject({ changed: { effects: 4 } });
    expect(
      await f.h({ root: '1:1', variableIds: ['old', 'float'], fields: ['effects'] }),
    ).toMatchObject({ matched: { effects: 0 } });
  });
  it('retains bare string write failures and returns partial results with injected time', async () => {
    const f = setup();
    f.bind.mockImplementationOnce(() => {
      throw 'write denied';
    });
    expect(await f.h({ variableIds: ['old'], dryRun: false })).toMatchObject({
      failed: [{ error: 'write denied' }],
      changed: { fills: 1 },
      complete: true,
    });
    let clock = 0;
    const get = f.api.variables.getVariableByIdAsync;
    f.api.variables.getVariableByIdAsync = mock(async (id: string) => {
      const v = await get(id);
      clock = 2;
      return v;
    });
    await expect(
      createBindVariablesByValueHandler(
        f.api,
        () => clock,
      )({ variableIds: ['old'], timeBudgetMs: 1 }),
    ).rejects.toThrow('no writes');
  });
  it('returns partial successful writes when time runs out between nodes', async () => {
    const f = setup();
    let clock = 0;
    f.bind.mockImplementation((object, key, variable) => {
      clock = 2;
      return { ...object, boundVariables: { [key]: alias(variable.id) } };
    });
    expect(
      await createBindVariablesByValueHandler(
        f.api,
        () => clock,
      )({ variableIds: ['old'], dryRun: false, timeBudgetMs: 1 }),
    ).toMatchObject({ visited: 1, complete: false, changed: { fills: 1 } });
  });
  it('uses the alias target collection default mode and validates every candidate before writing', async () => {
    const f = setup(),
      get = f.api.variables.getVariableByIdAsync;
    f.values.set('old', alias('new'));
    f.api.variables.getVariableByIdAsync = mock(async (id: string) => {
      const v = await get(id);
      return v && id === 'new'
        ? ({ ...v, variableCollectionId: 'other', valuesByMode: { otherMode: red } } as Variable)
        : v;
    });
    f.api.variables.getVariableCollectionByIdAsync = mock(
      async (id: string) =>
        ({ id, defaultModeId: id === 'other' ? 'otherMode' : 'm' }) as VariableCollection,
    );
    expect(await f.h({ variableIds: ['old'] })).toMatchObject({ matched: { fills: 2 } });
    await expect(f.h({ variableIds: ['old', 'missing'], dryRun: false })).rejects.toThrow(
      'not found',
    );
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('retains the async paint setter policy and ignores mixed and gradient paints', async () => {
    const f = setup(),
      setFillsAsync = mock(async () => {});
    Object.assign(f.nodes[0]!, { setFillsAsync });
    f.nodes[0]!.fills = [{ type: 'PATTERN' }, { type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    f.nodes[2]!.fills = f.mixed;
    expect(await f.h({ variableIds: ['old'], dryRun: false })).toMatchObject({
      changed: { fills: 1 },
    });
    expect(setFillsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('by-value safety regressions', () => {
  it.each(['fills', 'strokes', 'effects'] as const)(
    'preserves %s style links, including mixed styles',
    async group => {
      const f = setup();
      const styleKey = { fills: 'fillStyleId', strokes: 'strokeStyleId', effects: 'effectStyleId' }[
        group
      ];
      Object.assign(f.nodes[0]!, {
        [styleKey]: f.mixed,
        [group]:
          group === 'effects'
            ? [{ type: 'DROP_SHADOW', color: red }]
            : [{ type: 'SOLID', color: red }],
      });
      expect(
        await f.h({ root: '1:1', variableIds: ['old'], fields: [group], dryRun: false }),
      ).toMatchObject({
        skippedStyled: 1,
        skippedStyledSamples: [{ nodeId: '1:1', group }],
        changed: { [group]: 0 },
      });
      expect(f.bind).not.toHaveBeenCalled();
    },
  );
  it('filters scalar scopes and skips inactive layout, invisible strokes and high-risk defaults', async () => {
    const f = setup();
    Object.assign(f.nodes[0]!, {
      type: 'FRAME',
      layoutMode: 'NONE',
      paddingLeft: 8,
      itemSpacing: 8,
      gridRowGap: 8,
      strokeWeight: 8,
      strokes: [{ type: 'SOLID', visible: false }],
      width: 1,
      height: 1,
      opacity: 1,
      cornerRadius: 8,
    });
    f.variables.get('float')!.scopes = ['GAP'];
    expect(await f.h({ root: '1:1', variableIds: ['float'], fields: ['scalars'] })).toMatchObject({
      matched: { scalars: 0 },
    });
    Object.assign(f.nodes[0]!, { layoutMode: 'HORIZONTAL' });
    expect(await f.h({ root: '1:1', variableIds: ['float'], fields: ['scalars'] })).toMatchObject({
      matched: { scalars: 2 },
    });
    f.values.set('float', 1);
    f.variables.get('float')!.scopes = ['ALL_SCOPES'];
    expect(await f.h({ root: '1:1', variableIds: ['float'], fields: ['scalars'] })).toMatchObject({
      matched: { scalars: 0 },
    });
    expect(
      await f.h({
        root: '1:1',
        variableIds: ['float'],
        fields: ['scalars'],
        scalarFields: ['width', 'height', 'opacity'],
      }),
    ).toMatchObject({ matched: { scalars: 3 } });
    f.values.set('float', 0);
    Object.assign(f.nodes[0]!, { width: 0, height: 0, opacity: 0 });
    expect(await f.h({ root: '1:1', variableIds: ['float'], fields: ['scalars'] })).toMatchObject({
      matched: { scalars: 0 },
    });
  });
  it('filters colors by destination scope before ambiguity resolution', async () => {
    const f = setup();
    f.variables.get('old')!.scopes = ['TEXT_FILL'];
    f.variables.get('new')!.scopes = ['SHAPE_FILL'];
    expect(await f.h({ root: '1:1', variableIds: ['old', 'new'], dryRun: false })).toMatchObject({
      ambiguous: 0,
      changedSamples: [{ variableId: 'new' }],
    });
  });
  it('uses Dark only in the semantic collection, resolving Palette in its default mode', async () => {
    const f = setup();
    f.api.variables.getVariableByIdAsync = mock(
      async (id: string) =>
        ({
          ...f.variables.get(id),
          variableCollectionId: id === 'old' ? 'semantic' : 'palette',
          valuesByMode: id === 'old' ? { Dark: alias('new') } : { Light: red },
        }) as unknown as Variable,
    );
    f.api.variables.getVariableCollectionByIdAsync = mock(
      async (id: string) =>
        ({ id, defaultModeId: id === 'semantic' ? 'Dark' : 'Light' }) as VariableCollection,
    );
    expect(await f.h({ root: '1:1', variableIds: ['old'], modeId: 'Dark' })).toMatchObject({
      matched: { fills: 1 },
    });
    expect(await f.h({ root: '1:1', variableIds: ['old'], modeId: 'absent' })).toMatchObject({
      matched: { fills: 1 },
    });
  });
  it('continues after a throwing paint getter and truncates bare errors', async () => {
    const f = setup();
    Object.defineProperty(f.nodes[0], 'strokes', {
      get: () => {
        throw 'x'.repeat(200);
      },
    });
    expect(await f.h({ variableIds: ['old'], dryRun: false })).toMatchObject({
      complete: true,
      changed: { fills: 2 },
      failed: [{ error: 'x'.repeat(120) }],
    });
  });
});

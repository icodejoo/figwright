import { describe, expect, it, vi } from 'vitest';

import { TimeSlice } from '../../src/cooperative.js';
import { createRebindVariablesHandler } from '../../src/handlers/rebind-variables.js';
import { alias, fixture, gradient, solid } from './variable-bindings-fixture.js';

const mapping = [{ from: 'old', to: 'new' }];
const orphanFixture = () => {
  const f = fixture();
  const main = Object.assign(f.makeNode('main'), {
    type: 'COMPONENT',
    parent: null,
    removed: false,
    children: [Object.assign(f.makeNode('main-child'), { parent: null })],
  });
  Object.assign(main.children[0]!, { parent: main });
  const getMainComponentAsync = vi.fn<() => Promise<typeof main | null>>(async () => main);
  const instance = Object.assign(f.makeNode('instance', []), {
    type: 'INSTANCE',
    parent: null,
    overrides: [],
    getMainComponentAsync,
    children: [] as ReturnType<typeof f.makeNode>[],
  });
  f.page.children.splice(0, f.page.children.length, instance);
  return { ...f, main, instance, getMainComponentAsync };
};

describe('rebind_variables orphan mains', () => {
  it.each([false, true])(
    'rewrites a parentless main subtree with instance sublayers=%s and resumes idempotently',
    async includeInstanceSublayers => {
      const f = orphanFixture();
      const handler = createRebindVariablesHandler(f.api);
      const args = { mapping, includeOrphanMains: true, includeInstanceSublayers, dryRun: false };
      expect(await handler(args)).toMatchObject({
        complete: true,
        visited: 3,
        matched: { fills: 2 },
        changed: { fills: 2 },
        orphanMains: { visited: 2, count: 1, samples: ['main'] },
      });
      expect(f.main.fills).toEqual([solid('new')]);
      expect(f.main.children[0]!.fills).toEqual([solid('new')]);
      expect(await handler(args)).toMatchObject({ matched: { fills: 0 }, changed: { fills: 0 } });
      expect(f.writes).toHaveBeenCalledTimes(2);
    },
  );
  it('treats a main inside a detached component set as an orphan', async () => {
    const f = orphanFixture();
    const detachedSet = { type: 'COMPONENT_SET', parent: null, removed: false };
    Object.assign(f.main, { parent: detachedSet });
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        includeInstanceSublayers: true,
        dryRun: false,
      }),
    ).toMatchObject({ changed: { fills: 2 }, orphanMains: { count: 1, samples: ['main'] } });
  });
  it('does not treat a main whose parent chain reaches a page as an orphan', async () => {
    const f = orphanFixture();
    Object.assign(f.main, {
      parent: { type: 'COMPONENT_SET', parent: { type: 'PAGE', parent: null } },
    });
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        includeInstanceSublayers: true,
        dryRun: false,
      }),
    ).toMatchObject({ orphanMains: { count: 0 } });
  });
  it('does not query main components by default, even when traversing instance sublayers', async () => {
    const f = orphanFixture();
    for (const includeInstanceSublayers of [false, true])
      expect(
        await createRebindVariablesHandler(f.api)({
          mapping,
          includeInstanceSublayers,
          dryRun: false,
        }),
      ).toMatchObject({
        orphanMains: { visited: 0, count: 0, samples: [] },
      });
    expect(f.getMainComponentAsync).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('does not add an attached main as an extra root or process it twice', async () => {
    const f = orphanFixture();
    Object.assign(f.main, { parent: f.page });
    f.page.children.push(f.main);
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        dryRun: false,
      }),
    ).toMatchObject({
      visited: 3,
      changed: { fills: 2 },
      orphanMains: { visited: 0, count: 0 },
    });
    expect(f.getMainComponentAsync).toHaveBeenCalledTimes(1);
    expect(f.writes).toHaveBeenCalledTimes(2);
  });
  it('deduplicates shared main references in dryRun and performs zero writes', async () => {
    const f = orphanFixture();
    f.page.children.push({ ...f.instance, id: 'instance-2' });
    expect(
      await createRebindVariablesHandler(f.api)({ mapping, includeOrphanMains: true }),
    ).toMatchObject({
      visited: 4,
      matched: { fills: 2 },
      changed: { fills: 0 },
      perMapping: [{ count: 2 }],
      orphanMains: { visited: 2, count: 1, samples: ['main'] },
    });
    expect(f.getMainComponentAsync).toHaveBeenCalledTimes(2);
    expect(f.bind).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('writes a shared main only once and bounds the main id samples', async () => {
    const f = orphanFixture();
    f.page.children.push({ ...f.instance, id: 'instance-2' });
    for (let i = 0; i < 6; i++) {
      const main = Object.assign(f.makeNode(`main-${i}`), { parent: null });
      f.page.children.push(
        Object.assign(
          { ...f.instance, id: `instance-${i + 3}` },
          { getMainComponentAsync: vi.fn<() => Promise<typeof main>>(async () => main) },
        ),
      );
    }
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        dryRun: false,
      }),
    ).toMatchObject({
      matched: { fills: 8 },
      changed: { fills: 8 },
      orphanMains: {
        visited: 8,
        count: 7,
        samples: ['main', 'main-0', 'main-1', 'main-2', 'main-3'],
      },
    });
    expect(f.writes.mock.calls.filter(([id]) => id === 'main')).toHaveLength(1);
  });
  it.each([null, 'removed'])('ignores an unavailable main: %s', async state => {
    const f = orphanFixture();
    if (state === 'removed') f.main.removed = true;
    else f.getMainComponentAsync.mockResolvedValue(null);
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        dryRun: false,
      }),
    ).toMatchObject({
      complete: true,
      orphanMains: { count: 0, visited: 0 },
      changed: { fills: 0 },
    });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('preserves styles and selected fields on extra roots', async () => {
    const f = orphanFixture();
    Object.assign(f.main, { fillStyleId: 'style' });
    f.main.children[0]!.boundVariables = { paddingLeft: alias('float') };
    const result = await createRebindVariablesHandler(f.api)({
      mapping: [...mapping, { from: 'float', to: 'floatNew' }],
      includeOrphanMains: true,
      fields: ['fills'],
      dryRun: false,
    });
    expect(result).toMatchObject({ skippedStyled: 1, changed: { fills: 1, scalars: 0 } });
    expect(f.main.fills).toEqual([solid()]);
    expect(f.main.children[0]!.boundVariables).toEqual({ paddingLeft: alias('float') });
  });
  it.each([false, true])(
    'obeys nested instance boundaries inside orphan mains, sublayers=%s',
    async includeInstanceSublayers => {
      const f = orphanFixture();
      const child = f.main.children[0]!;
      const leaf = f.makeNode('Inested;leaf');
      Object.assign(child, {
        type: 'INSTANCE',
        children: [leaf],
        getMainComponentAsync: vi.fn<() => Promise<typeof f.main>>(async () => f.main),
        overrides: [{ id: leaf.id, overriddenFields: ['fills'] }],
      });
      Object.assign(leaf, { parent: child });
      expect(
        await createRebindVariablesHandler(f.api)({
          mapping,
          includeOrphanMains: true,
          includeInstanceSublayers,
          dryRun: false,
        }),
      ).toMatchObject({
        complete: true,
        changed: { fills: includeInstanceSublayers ? 2 : 1 },
        skippedInherited: 1,
        orphanMains: { count: 1, visited: includeInstanceSublayers ? 3 : 2 },
      });
      expect(child.fills).toEqual([solid()]);
    },
  );
  it('retains prior writes and stops before a main discovered after budget exhaustion', async () => {
    const f = orphanFixture();
    f.page.children.unshift(f.nodes[0]!);
    let clock = 0;
    f.getMainComponentAsync.mockImplementation(async () => {
      clock = 10;
      return f.main;
    });
    expect(
      await createRebindVariablesHandler(
        f.api,
        () => clock,
      )({ mapping, includeOrphanMains: true, dryRun: false, timeBudgetMs: 10 }),
    ).toMatchObject({
      complete: false,
      visited: 2,
      changed: { fills: 1 },
      orphanMains: { count: 1, visited: 0 },
    });
    expect(f.main.fills).toEqual([solid()]);
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        dryRun: false,
      }),
    ).toMatchObject({
      complete: true,
      changed: { fills: 2 },
    });
  });
  it('yields cooperatively while walking extra roots within the shared budget', async () => {
    const f = orphanFixture();
    const due = vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(true);
    const handoff = vi.spyOn(TimeSlice.prototype, 'yield').mockResolvedValue();
    try {
      expect(
        await createRebindVariablesHandler(f.api)({ mapping, includeOrphanMains: true }),
      ).toMatchObject({ orphanMains: { visited: 2 } });
      expect(handoff).toHaveBeenCalledTimes(2);
    } finally {
      due.mockRestore();
      handoff.mockRestore();
    }
  });
  it('reports lookup failures and continues to later instances', async () => {
    const f = orphanFixture();
    f.page.children.unshift(
      Object.assign(
        { ...f.instance, id: 'broken' },
        {
          getMainComponentAsync: vi.fn<() => Promise<never>>(async () => {
            throw new Error('unavailable main');
          }),
        },
      ),
    );
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping,
        includeOrphanMains: true,
        dryRun: false,
      }),
    ).toMatchObject({
      complete: true,
      failedCount: 1,
      failed: [{ nodeId: 'broken', error: 'unavailable main' }],
      changed: { fills: 2 },
      orphanMains: { count: 1 },
    });
  });
});
describe('rebind_variables', () => {
  it('supports a many-to-one collection merge and resumes idempotently for disjoint ids', async () => {
    const f = fixture();
    const handler = createRebindVariablesHandler(f.api);
    const merge = [...mapping, { from: 'other', to: 'new' }];
    expect(await handler({ mapping: merge, dryRun: false })).toMatchObject({
      changed: { fills: 2 },
      perMapping: [
        { from: 'old', count: 1 },
        { from: 'other', count: 1 },
      ],
    });
    expect(await handler({ mapping: merge, dryRun: false })).toMatchObject({
      matched: { fills: 0 },
    });
    expect(f.nodes[0]!.fills).toEqual([solid('new')]);
    expect(f.nodes[2]!.fills).toEqual([solid('new')]);
  });
  it('defaults to dryRun with no writes, excludes nested nodes and scalars', async () => {
    const f = fixture();
    f.nodes[0]!.boundVariables = { paddingLeft: alias('float') };
    const result = await createRebindVariablesHandler(f.api)({
      mapping: [...mapping, { from: 'float', to: 'floatNew' }],
    });
    expect(result).toMatchObject({
      dryRun: true,
      matched: { fills: 1, scalars: 0 },
      changed: { fills: 0, scalars: 0 },
      skippedInstances: 1,
      perMapping: [{ count: 1 }, { count: 0 }],
    });
    expect(f.bind).toHaveBeenCalledTimes(0);
    expect(f.writes).toHaveBeenCalledTimes(0);
  });
  it('writes only matches, repeats idempotently and reverses unambiguous mapping', async () => {
    const f = fixture();
    const handler = createRebindVariablesHandler(f.api);
    expect(await handler({ mapping, dryRun: false, includeInstanceSublayers: true })).toMatchObject(
      {
        changed: { fills: 2 },
        changedSamples: [
          { nodeId: '1:1', field: 'fill.color', from: 'old', to: 'new' },
          { nodeId: 'I1:2;2:3' },
        ],
      },
    );
    expect(f.nodes[0]!.fills).toEqual([solid('new')]);
    expect(f.nodes[1]!.fills).toEqual([solid('new')]);
    expect(f.writes.mock.calls).toEqual([
      ['1:1', 'fills'],
      ['I1:2;2:3', 'fills'],
    ]);
    expect(await handler({ mapping, dryRun: false, includeInstanceSublayers: true })).toMatchObject(
      { matched: { fills: 0 }, changed: { fills: 0 } },
    );
    expect(f.writes).toHaveBeenCalledTimes(2);
    expect(
      await handler({
        mapping: [{ from: 'new', to: 'old' }],
        dryRun: false,
        includeInstanceSublayers: true,
      }),
    ).toMatchObject({ changed: { fills: 2 } });
    expect(f.nodes[0]!.fills).toEqual([solid()]);
  });
  it.each([
    [],
    [{ from: 'old', to: 'old' }],
    [...mapping, ...mapping],
    [{ from: 'old', to: 'float' }],
    [...mapping, { from: 'missing', to: 'new' }],
    [{ from: 'old', to: 'missing' }],
  ])('rejects the whole invalid mapping %j before any write', async invalid => {
    const f = fixture();
    await expect(
      createRebindVariablesHandler(f.api)({ mapping: invalid, dryRun: false }),
    ).rejects.toThrow(/mapping|Variable/);
    expect(f.writes).toHaveBeenCalledTimes(0);
    expect(f.bind).toHaveBeenCalledTimes(0);
    expect(f.page.loadAsync).toHaveBeenCalledTimes(0);
  });
  it('limits fields; uses native effect/grid/scalar binding APIs for explicitly selected groups', async () => {
    const f = fixture();
    const node = f.nodes[0]!;
    node.boundVariables = { paddingLeft: alias('float') };
    Object.assign(node, {
      effects: [
        { type: 'DROP_SHADOW', boundVariables: { color: alias(), radius: alias('float') } },
      ],
      layoutGrids: [{ pattern: 'GRID', boundVariables: { sectionSize: alias('float') } }],
      strokes: [solid()],
    });
    const result = await createRebindVariablesHandler(f.api)({
      mapping: [...mapping, { from: 'float', to: 'floatNew' }],
      dryRun: false,
      fields: ['effects', 'layoutGrids', 'scalars', 'strokes'],
    });
    expect(result).toMatchObject({
      matched: { fills: 0, strokes: 1, effects: 2, layoutGrids: 1, scalars: 1 },
      changed: { fills: 0, strokes: 1, effects: 2, layoutGrids: 1, scalars: 1 },
    });
    expect(node.fills).toEqual([solid()]);
    expect(node.boundVariables.paddingLeft).toEqual(alias('floatNew'));
    expect(node).toMatchObject({
      effects: [{ boundVariables: { color: alias('new'), radius: alias('floatNew') } }],
      layoutGrids: [{ boundVariables: { sectionSize: alias('floatNew') } }],
    });
  });
  it('leaves non-color effect/grid bindings untouched by default', async () => {
    const f = fixture();
    Object.assign(f.nodes[0]!, {
      effects: [{ boundVariables: { color: alias(), radius: alias('float') } }],
      layoutGrids: [{ boundVariables: { sectionSize: alias('float') } }],
    });
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping: [...mapping, { from: 'float', to: 'floatNew' }],
        dryRun: false,
      }),
    ).toMatchObject({ changed: { fills: 1, effects: 1, layoutGrids: 0 } });
    expect(f.nodes[0]).toMatchObject({ effects: [{ boundVariables: { radius: alias('float') } }] });
  });
  it('reports gradient/mixed segments and scalar arrays without writing them', async () => {
    const f = fixture();
    f.nodes[0]!.fills = [gradient()];
    f.nodes[0]!.boundVariables = { fontSize: [alias('float')] };
    const text = f.makeNode('text', f.mixed);
    const setRangeFills = vi.fn<() => void>();
    Object.assign(text, {
      type: 'TEXT',
      getStyledTextSegments: () => [{ fills: [solid(), gradient()] }],
      setRangeFills,
    });
    f.page.children.push(text);
    f.writes.mockClear();
    expect(
      await createRebindVariablesHandler(f.api)({
        mapping: [...mapping, { from: 'float', to: 'floatNew' }],
        fields: ['fills', 'scalars'],
        dryRun: false,
      }),
    ).toMatchObject({
      matched: { fills: 0, scalars: 0 },
      unsupported: { gradient: 1, textSegment: 2, scalarArray: 1 },
    });
    expect(f.writes).toHaveBeenCalledTimes(0);
    expect(setRangeFills).toHaveBeenCalledTimes(0);
    expect(f.bind).toHaveBeenCalledTimes(0);
  });
  it('continues after bare-string failures and retains earlier field writes', async () => {
    const f = fixture();
    f.nodes[1]!.id = '2:2';
    Object.assign(f.nodes[1]!, { parent: null });
    f.page.children.splice(1, 1, f.nodes[1]!);
    Object.defineProperty(f.nodes[0], 'effects', {
      get: () => [{ boundVariables: { color: alias() } }],
      set: () => {
        throw 'original Figma failure ' + 'x'.repeat(150);
      },
    });
    expect(await createRebindVariablesHandler(f.api)({ mapping, dryRun: false })).toMatchObject({
      changed: { fills: 2, effects: 0 },
      failedCount: 1,
      failed: [
        { nodeId: '1:1', error: ('original Figma failure ' + 'x'.repeat(150)).slice(0, 120) },
      ],
    });
  });
  it('returns partial writes on injected budget exhaustion and resumes next call', async () => {
    const f = fixture();
    f.nodes[1]!.id = '2:2';
    Object.assign(f.nodes[1]!, { parent: null });
    f.page.children.splice(1, 1, f.nodes[1]!);
    let tick = 0;
    const now = () => (tick++ === 0 ? 0 : tick <= 2 ? 0 : 90_000);
    expect(
      await createRebindVariablesHandler(f.api, now)({ mapping, dryRun: false }),
    ).toMatchObject({ visited: 1, complete: false, changed: { fills: 1 } });
    expect(await createRebindVariablesHandler(f.api)({ mapping, dryRun: false })).toMatchObject({
      complete: true,
      changed: { fills: 1 },
    });
  });
  it('uses the existing async paint writer when a matched array includes a pattern', async () => {
    const f = fixture();
    f.nodes[0]!.fills = [solid(), { type: 'PATTERN' }];
    const setter = vi.fn<(paints: unknown) => Promise<void>>(async paints => {
      f.nodes[0]!.fills = paints;
    });
    Object.assign(f.nodes[0]!, { setFillsAsync: setter });
    await createRebindVariablesHandler(f.api)({ mapping, dryRun: false });
    expect(setter).toHaveBeenCalledTimes(1);
  });
  it('bounds failure and changed samples while keeping total counts', async () => {
    const f = fixture();
    f.page.children.length = 0;
    for (let i = 0; i < 80; i++) {
      const node = f.makeNode(`n${i}`);
      if (i < 25)
        Object.defineProperty(node, 'effects', {
          get: () => {
            throw new Error('unavailable');
          },
        });
      f.page.children.push(node);
    }
    const result = (await createRebindVariablesHandler(f.api)({ mapping, dryRun: false })) as {
      failed: unknown[];
      changedSamples: unknown[];
    };
    expect(result).toMatchObject({ visited: 80, failedCount: 25, changed: { fills: 55 } });
    expect(result.failed).toHaveLength(20);
    expect(result.changedSamples).toHaveLength(50);
  });
});

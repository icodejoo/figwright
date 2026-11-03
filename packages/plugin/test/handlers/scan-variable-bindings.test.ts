import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScanVariableBindingsHandler } from '../../src/handlers/scan-variable-bindings.js';
import * as serializer from '../../src/serializer.js';
import { alias, fixture, gradient, solid } from './variable-bindings-fixture.js';

afterEach(() => vi.restoreAllMocks());
describe('scan_variable_bindings', () => {
  it('counts canonical occurrences, nested bindings, mixed segments and scalars without serialization', async () => {
    const f = fixture();
    const first = f.nodes[0]!;
    first.boundVariables = {
      fills: [alias()],
      strokes: [alias()],
      effects: [alias()],
      layoutGrids: [alias()],
      topLeftRadius: alias(),
      paddingLeft: alias(),
    };
    Object.assign(first, {
      strokes: [solid()],
      effects: [{ boundVariables: { color: alias(), radius: alias('float') } }],
      layoutGrids: [{ boundVariables: { sectionSize: alias('float') } }],
    });
    first.fills = [solid(), solid(), gradient()];
    const text = f.makeNode('text', f.mixed);
    Object.assign(text, {
      type: 'TEXT',
      boundVariables: { fills: [alias()], textRangeFills: [alias()] },
      getStyledTextSegments: vi.fn<() => { fills: ReturnType<typeof solid>[] }[]>(() => [
        { fills: [solid()] },
        { fills: [solid()] },
      ]),
    });
    f.page.children.push(text);
    const flat = vi.spyOn(serializer, 'serializeFlatNodes');
    const trees = vi.spyOn(serializer, 'serializeTrees');
    const result = await createScanVariableBindingsHandler(f.api)({ sampleLimit: 1 });
    expect(result).toMatchObject({
      root: 'page',
      visited: 5,
      complete: true,
      bindings: expect.arrayContaining([
        {
          variableId: 'old',
          name: 'old',
          collectionName: 'colors',
          count: 10,
          editable: 9,
          nested: 1,
          fields: {
            'fill.color': 3,
            'fill.gradient': 1,
            'stroke.color': 1,
            'effect.color': 1,
            'node.topLeftRadius': 1,
            'node.paddingLeft': 1,
            'text.segment': 2,
          },
          samples: ['1:1'],
        },
      ]),
    });
    expect(result).toMatchObject({
      bindings: expect.arrayContaining([
        expect.objectContaining({
          variableId: 'float',
          count: 2,
          fields: { 'effect.radius': 1, 'layoutGrid.sectionSize': 1 },
        }),
      ]),
    });
    expect(flat).toHaveBeenCalledTimes(0);
    expect(trees).toHaveBeenCalledTimes(0);
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(3);
    expect(f.api.variables.getVariableCollectionByIdAsync).toHaveBeenCalledTimes(2);
  });
  it('intersects variable/collection filters and caches resolution, leaving unknown metadata absent', async () => {
    const f = fixture();
    f.nodes[0]!.fills = [solid(), solid(), solid('missing')];
    const result = await createScanVariableBindingsHandler(f.api)({
      collectionIds: ['colors'],
      variableIds: ['old', 'other', 'missing'],
    });
    expect(result).toMatchObject({ bindings: [{ variableId: 'old', count: 3 }] });
    expect((result as { bindings: unknown[] }).bindings).toHaveLength(1);
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(3);
    const unknown = await createScanVariableBindingsHandler(f.api)({ variableIds: ['missing'] });
    expect(unknown).toMatchObject({ bindings: [{ variableId: 'missing', count: 1 }] });
    expect((unknown as { bindings: object[] }).bindings[0]).not.toHaveProperty('name');
  });
  it('keeps counts when the injected budget expires, without reading later nodes', async () => {
    const f = fixture();
    let tick = 0;
    const now = () => (tick++ === 0 ? 0 : tick <= 2 ? 0 : 100_000);
    expect(await createScanVariableBindingsHandler(f.api, now)({})).toMatchObject({
      visited: 1,
      complete: false,
      bindings: [{ variableId: 'old', count: 1 }],
    });
    expect(f.api.variables.getVariableByIdAsync).toHaveBeenCalledTimes(0);
  });
  it('loads an explicit page before reading children; ordinary TEXT never reads segments', async () => {
    const f = fixture();
    Object.assign(f.nodes[0]!, {
      type: 'TEXT',
      getStyledTextSegments: vi.fn<() => never>(() => {
        throw new Error('must not read');
      }),
    });
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
    expect(await createScanVariableBindingsHandler(f.api)({ root: 'page' })).toMatchObject({
      visited: 4,
    });
    expect(f.page.loadAsync).toHaveBeenCalledTimes(1);
  });
});

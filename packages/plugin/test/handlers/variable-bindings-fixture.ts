import { vi } from 'vitest';

export const alias = (id = 'old') => ({ type: 'VARIABLE_ALIAS' as const, id });
export const solid = (id = 'old') => ({
  type: 'SOLID',
  color: { r: 1, g: 0, b: 0 },
  boundVariables: { color: alias(id) },
});
export const gradient = () => ({
  type: 'GRADIENT_LINEAR',
  gradientStops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 }, boundVariables: { color: alias() } },
  ],
});
export const fixture = () => {
  const mixed = Symbol('mixed');
  const writes = vi.fn<(id: string, field: string) => void>();
  const makeNode = (id: string, fills: unknown = [solid()]) => {
    const node = {
      id,
      type: 'RECTANGLE',
      boundVariables: {} as Record<string, unknown>,
      setBoundVariable: vi.fn<(key: string, variable: { id: string }) => void>((key, variable) => {
        writes(id, key);
        node.boundVariables[key] = alias(variable.id);
      }),
    };
    let value = fills;
    return Object.defineProperty(node, 'fills', {
      enumerable: true,
      get: () => value,
      set: next => {
        writes(id, 'fills');
        value = next;
      },
    }) as typeof node & { fills: unknown };
  };
  const nodes = [makeNode('1:1'), makeNode('I1:2;2:3'), makeNode('1:3', [solid('other')])];
  Object.assign(nodes[1]!, {
    parent: {
      type: 'INSTANCE',
      parent: null,
      overrides: [
        {
          id: nodes[1]!.id,
          overriddenFields: [
            'fills',
            'strokes',
            'effects',
            'layoutGrids',
            'paddingLeft',
            'cornerRadius',
          ],
        },
      ],
    },
  });
  const variables = new Map(
    ['old', 'new', 'other', 'float', 'floatNew'].map(id => [
      id,
      {
        id,
        name: id,
        scopes: ['ALL_SCOPES'],
        resolvedType: id.startsWith('float') ? 'FLOAT' : 'COLOR',
        variableCollectionId: id === 'other' ? 'otherCollection' : 'colors',
      },
    ]),
  );
  const bind = vi.fn<(object: object, key: string, variable: { id: string }) => object>(
    (object, key, variable) => ({
      ...object,
      boundVariables: {
        ...(object as { boundVariables?: object }).boundVariables,
        [key]: alias(variable.id),
      },
    }),
  );
  const page = {
    id: 'page',
    type: 'PAGE',
    children: [
      nodes[0]!,
      Object.assign(
        { id: 'instance', type: 'INSTANCE', boundVariables: {}, children: [nodes[1]!] },
        { overrides: [{ id: nodes[1]!.id, overriddenFields: ['fills'] }] },
      ) as unknown as (typeof nodes)[number],
      nodes[2]!,
    ],
    loadAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  const api = {
    mixed,
    currentPage: page,
    getNodeByIdAsync: vi.fn<(id: string) => Promise<typeof page | (typeof nodes)[number] | null>>(
      async id => (id === 'page' ? page : (nodes.find(node => node.id === id) ?? null)),
    ),
    variables: {
      getVariableByIdAsync: vi.fn<(id: string) => Promise<ReturnType<typeof variables.get> | null>>(
        async id => variables.get(id) ?? null,
      ),
      getVariableCollectionByIdAsync: vi.fn<(id: string) => Promise<{ id: string; name: string }>>(
        async id => ({ id, name: id }),
      ),
      setBoundVariableForPaint: bind,
      setBoundVariableForEffect: bind,
      setBoundVariableForLayoutGrid: bind,
    },
  } as unknown as typeof figma;
  return { api, nodes, page, variables, writes, bind, makeNode, mixed };
};

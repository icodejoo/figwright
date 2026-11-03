import type { SearchNodesResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSearchNodesHandler } from '../../src/handlers/search-nodes.js';
import * as serializer from '../../src/serializer.js';

// Every Date.now() read advances a fake clock by 1ms, so a time slice ends after a fixed number of
// reads instead of after however much work this machine fits into 40 real milliseconds.
const tickingClock = (): { mockRestore: () => void } => {
  let now = 0;
  return vi.spyOn(Date, 'now').mockImplementation(() => (now += 1));
};

const fake = (id: string, type: string, name: string, children?: SceneNode[]): SceneNode =>
  ({
    id,
    name,
    type,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    children,
  }) as unknown as SceneNode;

const fakeFigma = (
  pageChildren: SceneNode[],
  lookup: Record<string, BaseNode | null> = {},
): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

const tree = (): SceneNode[] => [
  fake('1:1', 'FRAME', 'Login Card', [
    fake('1:2', 'TEXT', 'Submit Button Label'),
    fake('1:3', 'RECTANGLE', 'submit bg'),
  ]),
  fake('1:4', 'TEXT', 'Footer'),
];

describe('search_nodes handler', () => {
  it('preserves the legacy default result field for field', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    expect(await handler({ name: '' })).toMatchSnapshot();
  });

  it('brief returns exactly five basic fields without full serialization or expensive getters', async () => {
    const node = fake('7:1', 'INSTANCE', 'Hidden instance');
    Object.assign(node, { visible: false, parent: null });
    for (const key of [
      'x',
      'y',
      'width',
      'height',
      'fills',
      'constraints',
      'locked',
      'getMainComponentAsync',
    ]) {
      Object.defineProperty(node, key, {
        get: () => {
          throw new Error(`must not read ${key}`);
        },
      });
    }
    const spy = vi.spyOn(serializer, 'serializeFlatNodes');
    try {
      expect(
        await createSearchNodesHandler(fakeFigma([node]))({ type: 'INSTANCE', brief: true }),
      ).toEqual({
        nodes: [
          { id: '7:1', name: 'Hidden instance', type: 'INSTANCE', parentId: null, visible: false },
        ],
      });
      expect(spy).not.toHaveBeenCalled();
      Object.assign(node, { parent: { id: '7:0' } });
      expect(
        await createSearchNodesHandler(fakeFigma([node]))({ type: 'INSTANCE', brief: true }),
      ).toEqual({
        nodes: [
          { id: '7:1', name: 'Hidden instance', type: 'INSTANCE', parentId: '7:0', visible: false },
        ],
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it.each([true, false])(
    'limit stops at a matching node before reading children or later nodes (brief=%s)',
    async brief => {
      const first = fake('7:1', 'FRAME', 'First');
      Object.defineProperty(first, 'children', {
        get: () => {
          throw new Error('must stop before children');
        },
      });
      const later = fake('7:2', 'TEXT', 'Later');
      Object.defineProperty(later, 'type', {
        get: () => {
          throw new Error('must not visit later node');
        },
      });
      const result = (await createSearchNodesHandler(fakeFigma([first, later]))({
        type: 'FRAME',
        brief,
        limit: 1,
      })) as SearchNodesResult;
      expect(result.nodes.map(n => n.id)).toEqual(['7:1']);
      expect(result.truncated).toBe(true);
    },
  );

  it.each([true, false])(
    'only marks truncated when the limit is reached (brief=%s)',
    async brief => {
      const handler = createSearchNodesHandler(fakeFigma(tree()));
      expect(await handler({ type: 'TEXT', brief, limit: 3 })).not.toHaveProperty('truncated');
      expect(await handler({ type: 'TEXT', brief })).not.toHaveProperty('truncated');
      expect(await handler({ type: 'TEXT', brief, limit: 2 })).toHaveProperty('truncated', true);
      expect(await handler({ type: 'VECTOR', brief, limit: 1 })).toEqual({ nodes: [] });
    },
  );

  it('explicit brief:false preserves the default result', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    expect(await handler({ type: 'TEXT', brief: false })).toEqual(await handler({ type: 'TEXT' }));
  });

  it.each([0, -1, 10001, 1.5, NaN, Infinity, '2', null])(
    'rejects invalid limit %s',
    async limit => {
      await expect(
        createSearchNodesHandler(fakeFigma(tree()))({ type: 'TEXT', limit }),
      ).rejects.toThrow(/limit/);
    },
  );

  it('rejects non-boolean brief', async () => {
    await expect(
      createSearchNodesHandler(fakeFigma(tree()))({ type: 'TEXT', brief: 'true' }),
    ).rejects.toThrow(/brief/);
  });

  it('keeps cooperative traversal with brief and limit', async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => fake(`7:${i}`, 'RECTANGLE', 'Match'));
    const clock = tickingClock();
    try {
      let finished = false;
      const pending = Promise.resolve(
        createSearchNodesHandler(fakeFigma(nodes))({ type: 'RECTANGLE', brief: true, limit: 150 }),
      ).then(result => {
        finished = true;
        return result as SearchNodesResult;
      });
      expect(await new Promise(resolve => setTimeout(() => resolve(finished), 0))).toBe(false);
      const result = await pending;
      expect(result.nodes.map(n => n.id)).toEqual(nodes.slice(0, 150).map(n => n.id));
      expect(result.truncated).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
  it('yields while searching expensive native names even when no nodes match', async () => {
    let elapsed = 0;
    let visited = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
    const nodes = Array.from({ length: 256 }, (_, index) => {
      const node = fake(`7:${index}`, 'INSTANCE', 'Other');
      Object.defineProperty(node, 'name', {
        get: () => {
          visited += 1;
          elapsed += 20;
          return 'Other';
        },
      });
      return node;
    });
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(visited), 0));
    try {
      const result = (await createSearchNodesHandler(fakeFigma(nodes))({
        name: 'IconPlaceholder',
        type: 'INSTANCE',
      })) as SearchNodesResult;
      expect(await hostTick).toBeLessThan(nodes.length);
      expect(result.nodes).toEqual([]);
      expect(visited).toBe(nodes.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not read names of nodes excluded by the requested type', async () => {
    const node = fake('7:1', 'VECTOR', 'Vector');
    Object.defineProperty(node, 'name', {
      get: () => {
        throw new Error('excluded native name must not be read');
      },
    });
    const result = (await createSearchNodesHandler(fakeFigma([node]))({
      name: 'IconPlaceholder',
      type: 'INSTANCE',
    })) as SearchNodesResult;
    expect(result.nodes).toEqual([]);
  });

  it('matches by case-insensitive name substring across the whole page', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ name: 'submit' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:3']);
  });

  it('matches by exact type', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ type: 'TEXT' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:4']);
  });

  it('ANDs name and type together', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ name: 'submit', type: 'TEXT' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });

  it('scopes to a root subtree when root id given', async () => {
    const nodes = tree();
    const handler = createSearchNodesHandler(
      fakeFigma(nodes, { '1:1': nodes[0] as unknown as BaseNode }),
    );
    const result = (await handler({ type: 'TEXT', root: '1:1' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });

  it('bounds main-component lookups on a large page without dropping or reordering matches', async () => {
    let pending = 0;
    let peak = 0;
    const instances = Array.from({ length: 1025 }, (_, index) => {
      const node = fake(`2:${index}`, 'INSTANCE', `Instance ${index}`);
      return Object.assign(node, {
        getMainComponentAsync: async () => {
          pending += 1;
          peak = Math.max(peak, pending);
          await Promise.resolve();
          if (index % 2 === 0) await Promise.resolve();
          pending -= 1;
          return { id: `3:${index}`, name: `Component ${index}`, key: `key-${index}` };
        },
      });
    });
    const page = { type: 'PAGE', children: instances } as unknown as PageNode;
    const handler = createSearchNodesHandler(fakeFigma([], { '1:1': page }));

    const result = (await handler({ root: '1:1', type: 'INSTANCE' })) as SearchNodesResult;

    expect(peak).toBeLessThanOrEqual(512);
    expect(result.nodes.map(node => node.id)).toEqual(instances.map(node => node.id));
    expect(result.nodes.map(node => node.mainComponent)).toEqual(
      instances.map((_, index) => ({
        id: `3:${index}`,
        name: `Component ${index}`,
        key: `key-${index}`,
      })),
    );
    expect(result.nodes.every(node => node.children === undefined)).toBe(true);
  });

  it('hands the thread back to Figma before a large search is done, dropping no match', async () => {
    const instances = Array.from({ length: 1025 }, (_, index) =>
      Object.assign(fake(`2:${index}`, 'INSTANCE', `Instance ${index}`), {
        getMainComponentAsync: async () => null,
      }),
    );
    const handler = createSearchNodesHandler(fakeFigma(instances));
    const clock = tickingClock();
    try {
      let finished = false;
      const read = Promise.resolve(handler({ type: 'INSTANCE' })).then(result => {
        finished = true;
        return result as SearchNodesResult;
      });
      const finishedWhenHostRan = await new Promise<boolean>(resolve =>
        setTimeout(() => resolve(finished), 0),
      );
      expect(finishedWhenHostRan).toBe(false);
      expect((await read).nodes).toHaveLength(instances.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('throws when neither name nor type is provided', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    await expect(handler({})).rejects.toThrow(/at least one/);
  });

  it('throws when name or type is the wrong type', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    await expect(handler({ name: 123 })).rejects.toThrow(/name/);
    await expect(handler({ type: 123 })).rejects.toThrow(/type/);
  });
});

it.each([true, false])(
  'combines data/name/type/root filters with limit (brief=%s)',
  async brief => {
    const nodes = tree();
    for (const n of [nodes[0]!, ...(nodes[0]! as FrameNode).children, nodes[1]!]) {
      Object.assign(n, {
        getPluginDataKeys: () => (n.id === '1:2' ? ['tag', 'other'] : []),
        getSharedPluginDataKeys: (ns: string) =>
          ns === 'figwright' && n.id === '1:2' ? ['shared'] : [],
      });
    }
    const handler = createSearchNodesHandler(fakeFigma(nodes, { '1:1': nodes[0]! }));
    expect(
      (
        (await handler({
          pluginData: { keys: ['absent', 'tag'] },
          sharedPluginData: { namespace: 'figwright' },
          type: 'TEXT',
          name: 'button',
          root: '1:1',
          brief,
          limit: 1,
        })) as SearchNodesResult
      ).nodes.map(n => n.id),
    ).toEqual(['1:2']);
    expect(
      await handler({
        pluginData: {},
        sharedPluginData: { namespace: 'figwright', keys: ['absent', 'shared'] },
        root: '1:1',
        name: 'BUTTON',
        type: 'TEXT',
        brief,
        limit: 1,
      }),
    ).toHaveProperty('truncated', true);
    expect(await handler({ name: 'Footer', root: '1:1', brief, limit: 1 })).toEqual({ nodes: [] });
    expect(((await handler({ pluginData: { keys: [] } })) as SearchNodesResult).nodes).toEqual([]);
    expect(
      ((await handler({ sharedPluginData: { namespace: 'other' } })) as SearchNodesResult).nodes,
    ).toEqual([]);
  },
);

describe('HEAD complex-tree evidence', () => {
  const complexTree = () => {
    const child = fake('I1:2;3:4', 'FRAME', 'Nested instance layer', [
      fake('I1:2;3:4;5:6', 'TEXT', 'Nested label'),
    ]);
    const instance = Object.assign(fake('1:2', 'INSTANCE', 'Card instance', [child]), {
      getMainComponentAsync: async () => ({ id: '9:1', name: 'Card', key: 'card-key' }),
    });
    const hidden = Object.assign(fake('2:1', 'RECTANGLE', 'Hidden locked'), {
      visible: false,
      locked: true,
    });
    const page = { id: '0:1', type: 'PAGE' };
    Object.assign(instance, { parent: page });
    Object.assign(hidden, { parent: page });
    Object.assign(child, { parent: instance, locked: true });
    Object.assign((child as FrameNode).children[0]!, { parent: child });
    return [instance, hidden];
  };
  it.each([false, true])('pins all default/brief fields, brief=%s', async brief => {
    const result = await createSearchNodesHandler(fakeFigma(complexTree()))({
      name: '',
      ...(brief ? { brief: true } : {}),
    });
    expect(result).toMatchSnapshot();
  });
});

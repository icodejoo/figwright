import { describe, expect, it, vi } from 'vitest';

import { createGetSelectionHandler } from '../../src/handlers/get-selection.js';
import { createScanNodesByTypesHandler } from '../../src/handlers/scan-nodes-by-types.js';
import { createScanTextNodesHandler } from '../../src/handlers/scan-text-nodes.js';
import * as serializer from '../../src/serializer.js';

const fixture = () => {
  const nodes = ['TEXT', 'TEXT_PATH', 'RECTANGLE'].map((type, i) =>
    Object.assign(
      {
        id: `1:${i}`,
        name: type,
        type,
        parent: { id: 'page', type: 'PAGE' },
        visible: i !== 1,
        locked: true,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
      type === 'RECTANGLE'
        ? {}
        : {
            characters: `Copy ${i}`,
            fontSize: 16,
            fontName: { family: 'Inter', style: 'Regular' },
            getStyledTextSegments: () => [],
            textPathStartData: { segment: 0, position: 0 },
          },
    ),
  ) as unknown as SceneNode[];
  const api = {
    currentPage: { id: 'page', name: 'Page', children: nodes, selection: nodes },
  } as unknown as typeof figma;
  return { nodes, api };
};
const tools = [
  {
    name: 'scan_nodes_by_types',
    create: createScanNodesByTypesHandler,
    args: { types: ['TEXT', 'TEXT_PATH', 'RECTANGLE'] },
    text: false,
  },
  { name: 'scan_text_nodes', create: createScanTextNodesHandler, args: {}, text: true },
  { name: 'get_selection', create: createGetSelectionHandler, args: {}, text: false },
];
describe.each(tools)('$name compatibility', ({ create, args }) => {
  it('preserves HEAD default fields', async () => {
    expect(await create(fixture().api)(args)).toMatchSnapshot();
  });
});

describe.each(tools)('$name brief', ({ name, create, args, text }) => {
  it('reads exactly cheap fields and never calls full serialization', async () => {
    const { nodes, api } = fixture();
    for (const node of nodes)
      for (const key of ['x', 'y', 'width', 'height', 'fills', 'fontName', 'fontSize', 'locked']) {
        Object.defineProperty(node, key, {
          get: () => {
            throw new Error(`expensive ${key}`);
          },
        });
      }
    const spy = vi.spyOn(serializer, 'serializeFlatNodes');
    try {
      const result = await create(api)({ ...args, brief: true });
      const expected = nodes
        .filter(node => !text || node.type !== 'RECTANGLE')
        .map(node =>
          Object.assign(
            {
              id: node.id,
              name: node.name,
              type: node.type,
              parentId: 'page',
              visible: node.visible,
            },
            text ? { characters: (node as TextNode).characters } : {},
          ),
        );
      expect(result).toEqual(
        name === 'get_selection'
          ? { pageId: 'page', pageName: 'Page', nodes: expected }
          : { nodes: expected },
      );
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('explicit false is identical to default', async () => {
    const handler = create(fixture().api);
    expect(await handler({ ...args, brief: false })).toEqual(await handler(args));
  });
  it('rejects invalid brief', async () => {
    await expect(create(fixture().api)({ ...args, brief: 'true' })).rejects.toThrow('brief');
  });
});
describe.each(tools.slice(0, 2))('$name limit', ({ create, args }) => {
  it.each([false, true])('stops before later expensive nodes, brief=%s', async brief => {
    const { nodes, api } = fixture();
    Object.defineProperty(nodes[1], 'type', {
      get: () => {
        throw new Error('visited later node');
      },
    });
    expect(await create(api)({ ...args, brief, limit: 1 })).toMatchObject({
      truncated: true,
      nodes: [{ id: '1:0' }],
    });
  });
  it.each([false, true])('only flags reaching the cap, brief=%s', async brief => {
    const handler = create(fixture().api);
    expect(await handler({ ...args, brief, limit: 10 })).not.toHaveProperty('truncated');
    expect(await handler({ ...args, brief, limit: 2 })).toHaveProperty('truncated', true);
  });
  it.each([0, -1, 1.5, 10001, NaN, Infinity, '2', null])('rejects limit %s', async limit => {
    await expect(create(fixture().api)({ ...args, limit })).rejects.toThrow('limit');
  });
});

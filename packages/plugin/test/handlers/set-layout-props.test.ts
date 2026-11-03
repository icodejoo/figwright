import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetLayoutPropsHandler } from '../../src/handlers/set-layout-props.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_layout_props handler', () => {
  it('sets layoutAlign / layoutGrow / layoutPositioning', async () => {
    const node = { id: '1:1', layoutAlign: 'INHERIT', layoutGrow: 0, layoutPositioning: 'AUTO' };
    const result = (await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutAlign: 'STRETCH',
      layoutGrow: 1,
      layoutPositioning: 'ABSOLUTE',
    })) as MutateResult;

    expect(node).toMatchObject({
      layoutAlign: 'STRETCH',
      layoutGrow: 1,
      layoutPositioning: 'ABSOLUTE',
    });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it.each(['MIN', 'CENTER', 'MAX'])(
    'refuses the deprecated layoutAlign %s, which Figma resets and would report as done',
    async value => {
      const node = { id: '1:1', layoutAlign: 'INHERIT', layoutGrow: 0, layoutPositioning: 'AUTO' };
      await expect(
        createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
          nodeId: '1:1',
          layoutAlign: value,
        }),
      ).rejects.toThrow(/no longer does anything.*align_nodes/s);
      expect(node.layoutAlign).toBe('INHERIT');
    },
  );

  it('leaves omitted fields untouched (partial update)', async () => {
    const node = { id: '1:1', layoutAlign: 'STRETCH', layoutGrow: 1, layoutPositioning: 'AUTO' };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutGrow: 0,
    });
    expect(node).toMatchObject({
      layoutAlign: 'STRETCH',
      layoutGrow: 0,
      layoutPositioning: 'AUTO',
    });
  });

  it('throws on missing node, a node without layout child props, or bad input', async () => {
    await expect(createSetLayoutPropsHandler(fakeFigma({}))({ nodeId: '9:9' })).rejects.toThrow(
      /not found/,
    );
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1' } }))({ nodeId: '1:1' }),
    ).rejects.toThrow(/no auto-layout child properties/);
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        layoutGrow: -1,
      }),
    ).rejects.toThrow(/layoutGrow/);
    await expect(createSetLayoutPropsHandler(fakeFigma({}))({})).rejects.toThrow(/nodeId/);
  });

  it('sets layoutSizingHorizontal / layoutSizingVertical', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
    };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'FILL',
    });
    expect(node).toMatchObject({ layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FILL' });
  });

  it('throws when the node lacks the sizing property', async () => {
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        layoutSizingVertical: 'HUG',
      }),
    ).rejects.toThrow(/does not support/);
  });

  it('sets and clears min/max size bounds', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      minWidth: null,
      maxWidth: 800,
      minHeight: null,
      maxHeight: null,
    };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      minWidth: 120,
      maxWidth: null, // clears the existing bound
      maxHeight: 300,
    });
    expect(node).toMatchObject({ minWidth: 120, maxWidth: null, minHeight: null, maxHeight: 300 });
  });

  it('rejects a non-positive bound and a node without bounds', async () => {
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        minWidth: 0,
      }),
    ).rejects.toThrow(/minWidth must be a positive number or null/);
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        maxHeight: 100,
      }),
    ).rejects.toThrow(/does not support maxHeight/);
  });

  it('surfaces an actionable error when Figma rejects a bound', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      set minWidth(_v: number | null) {
        throw new Error('node must be an auto layout frame or child');
      },
    };
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', minWidth: 50 }),
    ).rejects.toThrow(/bounds apply to auto-layout frames/);
  });

  it('surfaces an actionable error when Figma rejects a sizing value', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      set layoutSizingHorizontal(_v: string) {
        throw new Error('not an auto layout frame');
      },
    };
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
        nodeId: '1:1',
        layoutSizingHorizontal: 'HUG',
      }),
    ).rejects.toThrow(/HUG needs an auto-layout frame/);
  });
});

it('sets scroll direction and fixed child count, rejects unsupported nodes/counts before mutation and restores them in batch', async () => {
  const { createBatchHandler } = await import('../../src/handlers/batch.js');
  const { batch3Fake } = await import('./batch3-fake.js');
  const node = {
    id: 'x',
    parent: null,
    type: 'FRAME',
    name: 'Frame',
    layoutAlign: 'INHERIT',
    overflowDirection: 'NONE',
    numberOfFixedChildren: 0,
    children: [{ id: 'child' }],
  };
  const { ctx } = batch3Fake({ x: node });
  const set = createSetLayoutPropsHandler(ctx);
  await set({ nodeId: 'x', overflowDirection: 'VERTICAL', numberOfFixedChildren: 1 });
  expect(node).toMatchObject({ overflowDirection: 'VERTICAL', numberOfFixedChildren: 1 });
  await expect(
    set({ nodeId: 'x', overflowDirection: 'BOTH', numberOfFixedChildren: 2 }),
  ).rejects.toThrow('children.length');
  expect(node.overflowDirection).toBe('VERTICAL');
  const batch = createBatchHandler(ctx, {
    set_layout_props: set,
    rename_page: async () => {
      throw new Error('native failure');
    },
  });
  const page = { id: 'p', type: 'PAGE', name: 'page' };
  const { ctx: ctx2 } = batch3Fake({ x: node, p: page });
  const batch2 = createBatchHandler(ctx2, {
    set_layout_props: createSetLayoutPropsHandler(ctx2),
    rename_page: async () => {
      throw new Error('native failure');
    },
  });
  await expect(
    batch2({
      ops: [
        {
          tool: 'set_layout_props',
          params: { nodeId: 'x', overflowDirection: 'HORIZONTAL', numberOfFixedChildren: 0 },
        },
        { tool: 'rename_page', params: { pageId: 'p', name: 'bad' } },
      ],
    }),
  ).rejects.toThrow('native failure');
  expect(node).toMatchObject({ overflowDirection: 'VERTICAL', numberOfFixedChildren: 1 });
  await expect(
    createSetLayoutPropsHandler(fakeFigma({ x: { id: 'x', layoutAlign: 'INHERIT' } }))({
      nodeId: 'x',
      overflowDirection: 'VERTICAL',
    }),
  ).rejects.toThrow('does not support');
  // Refuse invalid batches before applying any scrolling change.
  await expect(batch({ ops: [] })).rejects.toThrow('not be empty');
});

import { type GetNodeResult, type MutateResult, SerializedPaintSchema } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createGetNodeHandler } from '../../src/handlers/get-node.js';
import { createSetFillsHandler } from '../../src/handlers/set-fills.js';

const fakeFigma = (
  lookup: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForPaint: (paint: object, field: string, v: { id: string }) => ({
        ...paint,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

describe('set_fills handler', () => {
  it('ignores the read-only cssAngle when a read gradient is written straight back', async () => {
    // get_design_context now returns cssAngle on linear gradients; feeding that paint back into
    // set_fills unchanged must still work, and must not leak a derived field into Figma.
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    await handler({
      nodeId: '1:1',
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          cssAngle: 165.96,
          gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }],
          gradientTransform: [
            [1, 0, 0],
            [-1, 1, 0],
          ],
        },
      ],
    });

    expect((node.fills as Record<string, unknown>[])[0]).not.toHaveProperty('cssAngle');
    expect((node.fills as { gradientTransform?: number[][] }[])[0]?.gradientTransform).toEqual([
      [1, 0, 0],
      [-1, 1, 0],
    ]);
  });

  it('applies SOLID fills to a node and returns ok + nodeId', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
    })) as MutateResult;

    expect(node.fills).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('applies a gradient fill (stops + transform round-trip into a GradientPaint)', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    const gradient = {
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
    await handler({ nodeId: '1:1', fills: [gradient] });
    expect(node.fills).toEqual([
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        opacity: 1,
        visible: true,
      },
    ]);
  });

  it('throws on a malformed gradient, IMAGE paint, missing node, or bad input', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    await expect(
      handler({ nodeId: '1:1', fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1 }] }),
    ).rejects.toThrow(/gradientStops/);
    await expect(
      handler({ nodeId: '1:1', fills: [{ type: 'IMAGE', visible: true, opacity: 1 }] }),
    ).rejects.toThrow(/unsupported paint type IMAGE/);
    await expect(handler({ nodeId: '9:9', fills: [] })).rejects.toThrow(/not found/);
    await expect(handler({ fills: [] })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '1:1', fills: 'x' })).rejects.toThrow(/fills/);
  });

  // A fill's variable binding lives on the paint (issue #164). Writing the paint back without
  // applying it would silently replace the token with the literal beside it.
  it('applies a paint binding, so a token fill stays a token', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(
      fakeFigma({ '1:1': node }, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'COLOR' } }),
    );
    await handler({
      nodeId: '1:1',
      fills: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: { r: 1, g: 0, b: 0 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(node.fills).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });

  it('leaves the node untouched when a bound variable cannot be resolved', async () => {
    const node = { id: '1:1', fills: 'UNTOUCHED' as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    await expect(
      handler({
        nodeId: '1:1',
        fills: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 1, g: 0, b: 0 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('set_fills: variable V:gone not found');
    expect(node.fills).toBe('UNTOUCHED');
  });

  // A colour taken from code is sRGB; written raw into a Display P3 file it would paint more
  // saturated than the code. Naming its space hands the conversion to Figma.
  it("converts a SOLID colour and a gradient stop that name their space, through Figma's util", async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const calls: unknown[] = [];
    const figmaCtx = {
      ...fakeFigma({ '1:1': node }),
      root: { documentColorProfile: 'DISPLAY_P3' },
      util: {
        rgb: (c: { r: number; g: number; b: number }) => {
          calls.push(c);
          return { r: c.r / 2, g: c.g / 2, b: c.b / 2 };
        },
      },
    } as unknown as typeof figma;
    await createSetFillsHandler(figmaCtx)({
      nodeId: '1:1',
      fills: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: { r: 0.8, g: 0.4, b: 0.2, space: 'SRGB' },
        },
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [
            { position: 0, color: { r: 1, g: 1, b: 1, a: 0.5, space: 'SRGB' } },
            { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
          ],
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
        },
      ],
    });
    expect(calls).toEqual([
      { space: 'SRGB', r: 0.8, g: 0.4, b: 0.2 },
      { space: 'SRGB', r: 1, g: 1, b: 1 },
    ]);
    const [solid, gradient] = node.fills as [SolidPaint, GradientPaint];
    expect(solid.color).toEqual({ r: 0.4, g: 0.2, b: 0.1 });
    expect(gradient.gradientStops[0]?.color).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
    // The stop that named no space keeps its channels.
    expect(gradient.gradientStops[1]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

it('preserves paint-level blends across serializer, codegen simplification and SOLID/gradient/PATTERN writes', async () => {
  const { serializePaint } = await import('../../src/serializer.js');
  const { simplifyPaint } = await import('@figwright/shared');
  const { toFigmaPaint } = await import('../../src/handlers/set-fills.js');
  const ctx = {} as typeof figma;
  for (const paint of [
    { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, visible: true, opacity: 1 },
    {
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      visible: true,
      opacity: 1,
    },
    {
      type: 'PATTERN',
      sourceNodeId: 'source',
      tileType: 'RECTANGULAR',
      scalingFactor: 1,
      spacing: { x: 0, y: 0 },
      horizontalAlignment: 'START',
      verticalAlignment: 'START',
      visible: true,
      opacity: 1,
    },
  ]) {
    const read = serializePaint({ ...paint, blendMode: 'MULTIPLY' } as unknown as Paint, null);
    expect(read.blendMode).toBe('MULTIPLY');
    expect(simplifyPaint(read).blendMode).toBe('MULTIPLY');
    expect(toFigmaPaint(read, ctx).blendMode).toBe('MULTIPLY');
    expect(
      serializePaint({ ...paint, blendMode: 'NORMAL' } as unknown as Paint, null),
    ).not.toHaveProperty('blendMode');
  }
  const image = serializePaint(
    {
      type: 'IMAGE',
      scaleMode: 'TILE',
      imageHash: 'x',
      rotation: 90,
      scalingFactor: 0.5,
      filters: { exposure: 0, contrast: 0.3 },
    } as Paint,
    null,
  );
  expect(image).toMatchObject({ rotation: 90, scalingFactor: 0.5, filters: { contrast: 0.3 } });
  expect(simplifyPaint(image)).toMatchObject({
    rotation: 90,
    scalingFactor: 0.5,
    filters: { contrast: 0.3 },
  });
});

describe('existing VIDEO and SHADER paints', () => {
  it('uses async dynamic-page writes and preserves all video paint fields', async () => {
    const setFillsAsync = vi.fn<(paints: readonly Paint[]) => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      get fills() {
        return [];
      },
      set fills(_v: unknown) {
        throw new Error('sync forbidden');
      },
      setFillsAsync,
    };
    const paint = {
      type: 'VIDEO',
      videoHash: 'existing-hash',
      scaleMode: 'CROP',
      videoTransform: [
        [1, 0, 0.25],
        [0, 1, 0],
      ],
      scalingFactor: 2,
      rotation: 90,
      filters: { contrast: 0.3 },
      opacity: 0.5,
      visible: false,
      blendMode: 'MULTIPLY',
    };
    expect(
      await createSetFillsHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', fills: [paint] }),
    ).toEqual({ ok: true, nodeId: '1:1' });
    expect(setFillsAsync).toHaveBeenCalledWith([paint]);
  });
  it('maps shader property ids, preserves aliases, and excludes read metadata', async () => {
    const setFillsAsync = vi.fn<(paints: readonly Paint[]) => Promise<void>>(async () => {});
    const node = { id: '1:1', fills: [], setFillsAsync };
    await createSetFillsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      fills: [
        {
          type: 'SHADER',
          shaderId: 'shader',
          opacity: 1,
          visible: true,
          shaderProperties: [
            { id: 'amount', name: 'Amount', type: 'NUMBER', value: 0.4 },
            { id: 'color', value: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
          ],
        },
      ],
    });
    expect(setFillsAsync).toHaveBeenCalledWith([
      {
        type: 'SHADER',
        id: 'shader',
        opacity: 1,
        visible: true,
        properties: { amount: 0.4, color: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
      },
    ]);
  });
  it('keeps native errors and does not import assets implicitly', async () => {
    const error = new Error('Shader not imported. Call figma.importShaderById(id) first.');
    const node = {
      id: '1:1',
      fills: [],
      setFillsAsync: vi.fn<() => Promise<void>>().mockRejectedValue(error),
    };
    await expect(
      createSetFillsHandler(fakeFigma({ '1:1': node }))({
        nodeId: '1:1',
        fills: [{ type: 'SHADER', shaderId: 'unloaded' }],
      }),
    ).rejects.toBe(error);
    await expect(
      createSetFillsHandler(fakeFigma({ '1:1': node }))({
        nodeId: '1:1',
        fills: [{ type: 'VIDEO' }],
      }),
    ).rejects.toThrow('videoHash');
  });
});

describe('VIDEO read/write round trip', () => {
  it.each(['FILL', 'FIT', 'CROP', 'TILE'] as const)(
    'preserves mixed SOLID/VIDEO fills in %s',
    async scaleMode => {
      const node = {
        id: '1:1',
        name: 'Media',
        type: 'RECTANGLE',
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        parent: { id: '0:1' },
        fills: [
          { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, visible: true, opacity: 1 },
          {
            type: 'VIDEO',
            videoHash: 'file-local-video',
            scaleMode,
            visible: false,
            opacity: 0.5,
            blendMode: 'MULTIPLY',
            filters: { contrast: 0.3, exposure: -0.2 },
            ...(scaleMode === 'CROP'
              ? {
                  videoTransform: [
                    [0.5, 0, 0.25],
                    [0, 0.5, 0.125],
                  ],
                }
              : { rotation: 90 }),
            ...(scaleMode === 'TILE' ? { scalingFactor: 2 } : {}),
          },
        ] as Paint[],
      };
      const original = structuredClone(node.fills);
      const ctx = fakeFigma({ '1:1': node });
      const read = createGetNodeHandler(ctx);
      const before = (await read({ nodeId: node.id })) as GetNodeResult;
      const readFills = before.node!.fills;
      if (readFills === undefined || readFills === 'mixed') throw new Error('expected paint array');
      const fills = readFills.map(paint => SerializedPaintSchema.parse(paint));
      expect(fills[1]).toHaveProperty('videoHash', 'file-local-video');
      expect(fills[1]).toMatchObject(
        scaleMode === 'CROP'
          ? {
              videoTransform: [
                [0.5, 0, 0.25],
                [0, 0.5, 0.125],
              ],
            }
          : { scaleMode },
      );
      expect(fills[1]).not.toHaveProperty('imageTransform');
      expect(await createSetFillsHandler(ctx)({ nodeId: node.id, fills })).toEqual({
        ok: true,
        nodeId: node.id,
      });
      expect(node.fills).toEqual(original);
      expect(await read({ nodeId: node.id })).toEqual(before);
    },
  );
});

import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetEffectsHandler } from '../../src/handlers/set-effects.js';

const fakeFigma = (
  lookup: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForEffect: (effect: object, field: string, v: { id: string }) => ({
        ...effect,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

const dropShadow = {
  type: 'DROP_SHADOW',
  visible: true,
  radius: 4,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  offset: { x: 0, y: 2 },
  spread: 0,
};

describe('set_effects handler', () => {
  it('applies effects to a node and returns ok + nodeId', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const handler = createSetEffectsHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', effects: [dropShadow] })) as MutateResult;

    expect(node.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 2 },
        spread: 0,
        blendMode: 'NORMAL',
        // Stated, not left out: Figma stores an omitted one as true (measured), and a CSS box-shadow
        // is false.
        showShadowBehindNode: false,
      },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it("writes a drop shadow as Figma's showShadowBehindNode false unless it says true", async () => {
    const node = { id: '1:1', effects: [] as unknown };
    await createSetEffectsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      effects: [
        dropShadow,
        { ...dropShadow, showShadowBehindNode: true },
        { ...dropShadow, showShadowBehindNode: false },
      ],
    });
    expect((node.effects as DropShadowEffect[]).map(e => e.showShadowBehindNode)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('carries a shadow blend mode, normal when none is given, and never puts the flag on an inner shadow', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const inner = { ...dropShadow, type: 'INNER_SHADOW' };
    await createSetEffectsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      effects: [{ ...dropShadow, blendMode: 'MULTIPLY' }, inner, { ...inner, blendMode: 'SCREEN' }],
    });
    const out = node.effects as Record<string, unknown>[];
    expect(out.map(e => e.blendMode)).toEqual(['MULTIPLY', 'NORMAL', 'SCREEN']);
    expect(out.slice(1).some(e => 'showShadowBehindNode' in e)).toBe(false);
  });

  it('throws on missing node, bad input, or shadow without color/offset', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const handler = createSetEffectsHandler(fakeFigma({ '1:1': node }));
    await expect(handler({ nodeId: '9:9', effects: [] })).rejects.toThrow(/not found/);
    await expect(handler({ effects: [] })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '1:1', effects: 'x' })).rejects.toThrow(/effects/);
    await expect(
      handler({ nodeId: '1:1', effects: [{ type: 'DROP_SHADOW', visible: true }] }),
    ).rejects.toThrow(/color and offset/);
  });

  it('applies a shadow binding, so a token shadow colour stays a token', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const handler = createSetEffectsHandler(
      fakeFigma({ '1:1': node }, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'COLOR' } }),
    );
    await handler({
      nodeId: '1:1',
      effects: [{ ...dropShadow, boundVariables: { color: 'V:1' } }],
    });
    expect(node.effects).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });
});

it('round-trips progressive, all noise variants, texture and typed glass through the real serializer', async () => {
  const { serializeEffect } = await import('../../src/serializer.js');
  const effects = [
    {
      type: 'LAYER_BLUR',
      visible: true,
      radius: 20,
      blurType: 'PROGRESSIVE',
      startRadius: 2,
      startOffset: { x: 0.1, y: 0.2 },
      endOffset: { x: 0.8, y: 1 },
    },
    {
      type: 'BACKGROUND_BLUR',
      visible: false,
      radius: 8,
      blurType: 'PROGRESSIVE',
      startRadius: 0,
      startOffset: { x: 0, y: 0 },
      endOffset: { x: 1, y: 1 },
    },
    ...['MONOTONE', 'DUOTONE', 'MULTITONE'].map(noiseType =>
      Object.assign({
        type: 'NOISE',
        noiseType,
        visible: true,
        noiseSize: 3,
        noiseSizeVector: { x: 3, y: 7 },
        density: 0.6,
        color: { r: 1, g: 0.5, b: 0, a: 0.7 },
        ...(noiseType === 'MULTITONE' ? { opacity: 0.4 } : {}),
        ...(noiseType === 'DUOTONE' ? { secondaryColor: { r: 0, g: 0, b: 0, a: 0.2 } } : {}),
      }),
    ),
    {
      type: 'TEXTURE',
      visible: true,
      noiseSize: 4,
      noiseSizeVector: { x: 4, y: 9 },
      radius: 10,
      clipToShape: false,
    },
    {
      type: 'GLASS',
      visible: true,
      radius: 5,
      lightIntensity: 0.5,
      lightAngle: 30,
      refraction: 0.6,
      depth: 2,
      dispersion: 0.4,
    },
  ];
  const read = effects.map(e => serializeEffect(e as unknown as Effect, null));
  const node = { id: 'x', effects: [] as unknown };
  await createSetEffectsHandler(fakeFigma({ x: node }))({ nodeId: 'x', effects: read });
  expect(node.effects).toEqual(effects);
  expect((node.effects as Effect[]).map(e => serializeEffect(e, null))).toEqual(read);
});
it('rejects incomplete new effects, mismatched noise axes and unsupported fields before changing effects', async () => {
  const node = { id: 'x', effects: [dropShadow] as unknown };
  const set = createSetEffectsHandler(
    fakeFigma({ x: node }, { v: { id: 'v', name: 'radius', resolvedType: 'FLOAT' } }),
  );
  for (const effect of [
    { type: 'LAYER_BLUR', blurType: 'PROGRESSIVE' },
    {
      type: 'NOISE',
      noiseType: 'DUOTONE',
      noiseSizeVector: { x: 2, y: 3 },
      density: 1,
      color: { r: 0, g: 0, b: 0, a: 1 },
    },
    { type: 'NOISE', noiseType: 'MONOTONE', noiseSize: 1, noiseSizeVector: { x: 2, y: 3 } },
    { type: 'NOISE', blendMode: 'NORMAL' },
    { type: 'GLASS', splay: 0 },
    { type: 'TEXTURE', noiseSize: 2 },
    { type: 'TEXTURE', boundVariables: { radius: 'v' } },
  ]) {
    await expect(set({ nodeId: 'x', effects: [{ ...effect, visible: true }] })).rejects.toThrow(
      /requires|must equal|rejected|not writable|does not support/,
    );
    expect(node.effects).toEqual([dropShadow]);
  }
});

it('rejects MULTITONE without its API-required color before writing', async () => {
  const node = { id: 'x', effects: [dropShadow] };
  await expect(
    createSetEffectsHandler(fakeFigma({ x: node }))({
      nodeId: 'x',
      effects: [
        {
          type: 'NOISE',
          visible: true,
          noiseType: 'MULTITONE',
          noiseSize: 2,
          density: 1,
          opacity: 0.5,
        },
      ],
    }),
  ).rejects.toThrow('NOISE requires color (including MULTITONE)');
  expect(node.effects).toEqual([dropShadow]);
});

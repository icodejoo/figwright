import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateEffectStyleHandler } from '../../src/handlers/create-effect-style.js';

const fakeFigma = (
  variables: Record<string, unknown> = {},
): { figma: typeof figma; style: Record<string, unknown>; creations: () => number } => {
  const style: Record<string, unknown> = { id: 'E:0', name: '' };
  let created = 0;
  const figmaCtx = {
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForEffect: (effect: object, field: string, v: { id: string }) => ({
        ...effect,
        boundVariables: {
          ...(effect as { boundVariables?: object }).boundVariables,
          [field]: { type: 'VARIABLE_ALIAS', id: v.id },
        },
      }),
    },
    createEffectStyle: () => {
      created += 1;
      return style;
    },
  } as unknown as typeof figma;
  return { figma: figmaCtx, style, creations: () => created };
};

describe('create_effect_style handler', () => {
  it('creates an effect style from a blur effect', async () => {
    const { figma: f, style } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    const result = (await handler({
      name: 'Elevation/Blur',
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 8 }],
    })) as StyleResult;

    expect(style.effects).toEqual([{ type: 'LAYER_BLUR', visible: true, radius: 8 }]);
    expect(result).toEqual({ ok: true, styleId: 'E:0', name: 'Elevation/Blur' });
  });

  it('throws on bad input', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    await expect(handler({ effects: [] })).rejects.toThrow(/name/);
    await expect(handler({ name: 'x', effects: 'no' })).rejects.toThrow(/effects/);
  });

  // Same rule as create_paint_style: resolve the bindings first, or a bad id leaves a style behind.
  it('creates nothing when a bound variable cannot be resolved', async () => {
    const { figma: f, creations } = fakeFigma();
    await expect(
      createCreateEffectStyleHandler(f)({
        name: 'Elevation/focus',
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: 2 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('create_effect_style: variable V:gone not found');
    expect(creations()).toBe(0);
  });

  it('carries a shadow binding onto the created style', async () => {
    const { figma: f, style } = fakeFigma({
      'V:1': { id: 'V:1', name: 'color/information', resolvedType: 'COLOR' },
    });
    await createCreateEffectStyleHandler(f)({
      name: 'Elevation/focus',
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 4,
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 0, y: 2 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(style.effects).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });
});

it.each([
  { type: 'GLASS', visible: true, splay: 0 },
  { type: 'NOISE', visible: true, noiseType: 'MULTITONE', noiseSize: 2, density: 1, opacity: 0.5 },
])('creates no orphan when effect conversion rejects $type', async effect => {
  const { figma: f, creations } = fakeFigma();
  await expect(
    createCreateEffectStyleHandler(f)({ name: 'bad', effects: [effect] }),
  ).rejects.toThrow(/not writable|requires color/);
  expect(creations()).toBe(0);
});

it('removes a newly created style if Figma rejects effects and rethrows the original error', async () => {
  const { figma: f, style } = fakeFigma();
  const failure = new Error('Figma rejected effects');
  let removed = false;
  Object.defineProperty(style, 'effects', {
    set() {
      throw failure;
    },
  });
  style.remove = () => {
    removed = true;
  };
  await expect(
    createCreateEffectStyleHandler(f)({
      name: 'bad',
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 2 }],
    }),
  ).rejects.toBe(failure);
  expect(removed).toBe(true);
});

it('reports both the original error and the cleanup error if removal also fails', async () => {
  const { figma: f, style } = fakeFigma();
  const failure = new Error('Figma rejected effects');
  const cleanupFailure = new Error('Figma rejected removal');
  Object.defineProperty(style, 'effects', {
    set() {
      throw failure;
    },
  });
  style.remove = () => {
    throw cleanupFailure;
  };
  const result = createCreateEffectStyleHandler(f)({
    name: 'bad',
    effects: [{ type: 'LAYER_BLUR', visible: true, radius: 2 }],
  });
  await expect(result).rejects.toMatchObject({ errors: [failure, cleanupFailure] });
  await expect(result).rejects.toThrow(/Figma rejected effects.*Figma rejected removal/);
});

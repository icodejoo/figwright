import { expect, it } from 'vitest';

import { effectItemSchema } from '../../src/tools/effect-schema.js';
it('keeps every editable new effect field in the advertised schema and rejects unknown effect kinds', () => {
  const progressive = {
    type: 'LAYER_BLUR',
    visible: true,
    blurType: 'PROGRESSIVE',
    radius: 20,
    startRadius: 2,
    startOffset: { x: 0, y: 0 },
    endOffset: { x: 1, y: 1 },
  };
  const noise = {
    type: 'NOISE',
    visible: true,
    noiseType: 'DUOTONE',
    noiseSizeVector: { x: 2, y: 4 },
    density: 0.7,
    color: { r: 0, g: 0, b: 0, a: 1 },
    secondaryColor: { r: 1, g: 1, b: 1, a: 0.5 },
  };
  const texture = { type: 'TEXTURE', visible: true, noiseSize: 3, radius: 4, clipToShape: false };
  const glass = {
    type: 'GLASS',
    visible: true,
    radius: 3,
    lightIntensity: 0.8,
    lightAngle: 45,
    refraction: 0.4,
    depth: 2,
    dispersion: 0.3,
  };
  for (const effect of [progressive, noise, texture, glass])
    expect(effectItemSchema.parse(effect)).toEqual(effect);
  expect(effectItemSchema.safeParse({ type: 'SHADER', visible: true })).toHaveProperty(
    'success',
    false,
  );
  expect(effectItemSchema.safeParse({ ...glass, depth: 0.5 })).toHaveProperty('success', false);
});

it('preserves the required MULTITONE color through schema parsing', () => {
  const effect = {
    type: 'NOISE',
    visible: true,
    noiseType: 'MULTITONE',
    noiseSizeVector: { x: 2, y: 3 },
    density: 0.7,
    opacity: 0.4,
    color: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
  };
  expect(effectItemSchema.parse(effect)).toEqual(effect);
});

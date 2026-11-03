import { expect, it } from 'vitest';

import { setImageFillTool } from '../../src/tools/set-image-fill.js';
it('validates all seven filter ranges and exact affine matrix dimensions', () => {
  const schema = setImageFillTool.inputSchema;
  for (const key of [
    'exposure',
    'contrast',
    'saturation',
    'temperature',
    'tint',
    'highlights',
    'shadows',
  ]) {
    expect(schema.safeParse({ nodeId: 'x', data: 'bytes', filters: { [key]: 1 } })).toHaveProperty(
      'success',
      true,
    );
    expect(
      schema.safeParse({ nodeId: 'x', data: 'bytes', filters: { [key]: 1.1 } }),
    ).toHaveProperty('success', false);
  }
  expect(
    schema.safeParse({
      nodeId: 'x',
      data: 'bytes',
      imageTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      rotation: 90,
      scalingFactor: 0.5,
      blendMode: 'MULTIPLY',
    }),
  ).toHaveProperty('success', true);
  expect(
    schema.safeParse({
      nodeId: 'x',
      imageTransform: [
        [1, 0],
        [0, 1],
      ],
    }),
  ).toHaveProperty('success', false);
});

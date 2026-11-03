import { expect, it } from 'vitest';

import { exportSettingSchema } from '../../src/tools/export-settings-schema.js';
it('preserves native export fields and validates size constraints and profiles', () => {
  const settings = {
    format: 'PNG',
    constraint: { type: 'HEIGHT', value: 512 },
    contentsOnly: false,
    useAbsoluteBounds: true,
    suffix: '@export',
    colorProfile: 'DISPLAY_P3_V4',
  };
  expect(exportSettingSchema.parse(settings)).toEqual(settings);
  for (const constraint of [
    { type: 'WIDTH', value: 0 },
    { type: 'UNKNOWN', value: 20 },
  ])
    expect(exportSettingSchema.safeParse({ ...settings, constraint })).toHaveProperty(
      'success',
      false,
    );
  expect(exportSettingSchema.safeParse({ ...settings, colorProfile: 'DISPLAY_P3' })).toHaveProperty(
    'success',
    false,
  );
  expect(exportSettingSchema.safeParse({ format: 'JSON_REST_V1' })).toHaveProperty(
    'success',
    false,
  );
});

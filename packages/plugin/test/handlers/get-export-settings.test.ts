import { expect, it } from 'vitest';

import { createGetExportSettingsHandler } from '../../src/handlers/get-export-settings.js';
import { batch3Fake } from './batch3-fake.js';
it('reads all saved presets including media without filtering, and rejects non-exportable nodes', async () => {
  const settings = [
    { format: 'SVG', svgOutlineText: false },
    { format: 'MP4', fps: 30 },
  ];
  const { ctx } = batch3Fake({ x: { id: 'x', exportSettings: settings }, y: { id: 'y' } });
  const get = createGetExportSettingsHandler(ctx);
  expect(await get({ nodeId: 'x' })).toEqual({ nodeId: 'x', settings });
  await expect(get({ nodeId: 'y' })).rejects.toThrow('not exportable');
});

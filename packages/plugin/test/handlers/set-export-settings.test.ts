import { expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetExportSettingsHandler } from '../../src/handlers/set-export-settings.js';
import { batch3Fake } from './batch3-fake.js';
it('writes and clears presets, rejects format mismatches and rolls back to original media presets', async () => {
  const old = [{ format: 'MP4' }];
  const node = { id: 'x', type: 'PAGE', name: 'page', exportSettings: old };
  const { ctx } = batch3Fake({ x: node });
  const set = createSetExportSettingsHandler(ctx);
  const settings = [
    { format: 'PNG', constraint: { type: 'WIDTH', value: 256 }, colorProfile: 'SRGB' },
    { format: 'SVG', svgOutlineText: false, svgIdAttribute: true, svgSimplifyStroke: false },
  ];
  await set({ nodeId: 'x', settings });
  expect(node.exportSettings).toEqual(settings);
  await expect(
    set({ nodeId: 'x', settings: [{ format: 'PNG', svgOutlineText: false }] }),
  ).rejects.toThrow('SVG');
  await expect(
    set({ nodeId: 'x', settings: [{ format: 'PDF', constraint: { type: 'WIDTH', value: 20 } }] }),
  ).rejects.toThrow('constraint');
  node.exportSettings = old;
  const batch = createBatchHandler(ctx, {
    set_export_settings: set,
    rename_page: async () => {
      throw new Error('fail');
    },
  });
  await expect(
    batch({
      ops: [
        { tool: 'set_export_settings', params: { nodeId: 'x', settings: [] } },
        { tool: 'rename_page', params: { pageId: 'x', name: 'fail' } },
      ],
    }),
  ).rejects.toThrow('fail');
  expect(node.exportSettings).toEqual(old);
  await set({ nodeId: 'x', settings: [] });
  expect(node.exportSettings).toEqual([]);
});

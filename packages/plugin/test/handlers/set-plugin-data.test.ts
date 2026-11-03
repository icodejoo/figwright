import { expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetPluginDataHandler } from '../../src/handlers/set-plugin-data.js';
import { batch3Fake, fakeData } from './batch3-fake.js';
it('writes/deletes on each target kind and restores private/shared data after a later failure', async () => {
  const target = { id: 'x', type: 'PAGE', name: 'page', ...fakeData() };
  const { ctx } = batch3Fake({ x: target });
  const set = createSetPluginDataHandler(ctx);
  for (const targetType of ['NODE', 'STYLE', 'VARIABLE', 'VARIABLE_COLLECTION'])
    for (const namespace of [undefined, 'figwright']) {
      const p = { targetType, targetId: 'x', namespace, key: 'tag' };
      await set({ ...p, value: 'before' });
      const batch = createBatchHandler(ctx, {
        set_plugin_data: set,
        rename_page: async () => {
          throw new Error('native failure');
        },
      });
      await expect(
        batch({
          ops: [
            { tool: 'set_plugin_data', params: { ...p, value: 'after' } },
            { tool: 'rename_page', params: { pageId: 'x', name: 'fail' } },
          ],
        }),
      ).rejects.toThrow('native failure');
      expect(
        namespace === undefined
          ? target.getPluginData('tag')
          : target.getSharedPluginData(namespace, 'tag'),
      ).toBe('before');
      await set({ ...p, value: '' });
      expect(
        namespace === undefined
          ? target.getPluginDataKeys()
          : target.getSharedPluginDataKeys(namespace),
      ).toEqual([]);
    }
});

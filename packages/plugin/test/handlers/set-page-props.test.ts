import { expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetPagePropsHandler } from '../../src/handlers/set-page-props.js';
import { batch3Fake } from './batch3-fake.js';
it('moves pages both ways using final indexes and restores full order and backgrounds after batch failure', async () => {
  const a = { id: 'a', type: 'PAGE', name: 'Page', flowStartingPoints: [], backgrounds: [] },
    b = { id: 'b', type: 'PAGE', name: 'Page', flowStartingPoints: [], backgrounds: [] },
    c = { id: 'c', type: 'PAGE', name: 'Page', flowStartingPoints: [], backgrounds: [] };
  const { ctx, root } = batch3Fake({ a, b, c });
  root.children.push(a, b, c);
  const set = createSetPagePropsHandler(ctx);
  await set({ pageId: 'a', index: 2 });
  expect(root.children).toEqual([b, c, a]);
  await set({ pageId: 'a', index: 0 });
  expect(root.children).toEqual([a, b, c]);
  const batch = createBatchHandler(ctx, {
    set_page_props: set,
    save_version: async () => {
      throw new Error('should not run');
    },
    rename_page: async () => {
      throw new Error('native failure');
    },
  });
  await expect(
    batch({
      ops: [
        {
          tool: 'set_page_props',
          params: {
            pageId: 'a',
            index: 2,
            backgrounds: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
          },
        },
        { tool: 'set_page_props', params: { pageId: 'b', index: 2 } },
        { tool: 'rename_page', params: { pageId: 'c', name: 'fail' } },
      ],
    }),
  ).rejects.toThrow('native failure');
  expect(root.children).toEqual([a, b, c]);
  expect(a.backgrounds).toEqual([]);
  await expect(set({ pageId: 'a', index: 3 })).rejects.toThrow('index');
  await expect(set({ pageId: 'missing' })).rejects.toThrow('not found');
});

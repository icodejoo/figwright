import { describe, expect, it, vi } from 'vitest';

import { createGetStyleConsumersHandler } from '../../src/handlers/get-style-consumers.js';

describe('get_style_consumers', () => {
  it('preserves every applied field and marks truncated results', async () => {
    const page = { id: 'p', name: 'Page', type: 'PAGE', parent: null };
    const getStyleConsumersAsync = vi.fn<
      () => Promise<{ node: { id: string; name: string; parent: typeof page }; fields: string[] }[]>
    >(async () => [
      { node: { id: 'a', name: 'A', parent: page }, fields: ['fillStyleId', 'strokeStyleId'] },
      { node: { id: 'b', name: 'B', parent: page }, fields: ['textStyleId'] },
    ]);
    const ctx = {
      getStyleByIdAsync: async () => ({ id: 's', getStyleConsumersAsync }),
      loadAllPagesAsync: vi.fn<() => Promise<void>>(async () => {}),
    } as unknown as typeof figma;
    await expect(
      createGetStyleConsumersHandler(ctx)({ styleId: 's', limit: 1 }),
    ).resolves.toMatchObject({
      styleId: 's',
      truncated: true,
      consumers: [{ id: 'a', fields: ['fillStyleId', 'strokeStyleId'], page: { id: 'p' } }],
    });
    await expect(
      createGetStyleConsumersHandler(ctx)({ styleId: 's', limit: 2 }),
    ).resolves.toMatchObject({ truncated: false });
    expect(getStyleConsumersAsync).toHaveBeenCalledTimes(2);
  });
  it('returns missing-style and native errors', async () => {
    const ctx = { getStyleByIdAsync: async () => null } as unknown as typeof figma;
    await expect(createGetStyleConsumersHandler(ctx)({ styleId: 'bad' })).rejects.toThrow(
      /not found/,
    );
    const error = new Error('native load error');
    await expect(
      createGetStyleConsumersHandler({
        getStyleByIdAsync: async () => ({ id: 's' }),
        loadAllPagesAsync: async () => {
          throw error;
        },
      } as unknown as typeof figma)({ styleId: 's' }),
    ).rejects.toBe(error);
  });
});

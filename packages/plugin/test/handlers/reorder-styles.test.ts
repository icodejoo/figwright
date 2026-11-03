import { describe, expect, it, vi } from 'vitest';

import { createReorderStylesHandler } from '../../src/handlers/reorder-styles.js';

describe('reorder_styles', () => {
  it.each(['Paint', 'Text', 'Effect', 'Grid', 'CustomAnimation'])(
    'uses the %s API with style objects and null for first',
    async api => {
      const kind = api === 'CustomAnimation' ? 'CUSTOM_ANIMATION' : api.toUpperCase();
      const target = { id: 'a', type: kind, name: 'Folder/A', remote: false };
      const reference = { id: 'b', type: kind, name: 'Folder/B', remote: false };
      const move = vi.fn<(...args: unknown[]) => void>();
      const ctx = {
        getStyleByIdAsync: async (id: string) => (id === 'a' ? target : reference),
        [`moveLocal${api}StyleAfter`]: move,
      } as unknown as typeof figma;
      await createReorderStylesHandler(ctx)({ kind, styleId: 'a', afterStyleId: 'b' });
      expect(move).toHaveBeenLastCalledWith(target, reference);
      await createReorderStylesHandler(ctx)({ kind, styleId: 'a' });
      expect(move).toHaveBeenLastCalledWith(target, null);
    },
  );
  it('rejects different folders, kinds and remote styles', async () => {
    const a = { id: 'a', type: 'TEXT', name: 'A/One', remote: false };
    const b = { id: 'b', type: 'TEXT', name: 'B/Two', remote: false };
    const move = vi.fn<(...args: unknown[]) => void>();
    const handler = createReorderStylesHandler({
      getStyleByIdAsync: async (id: string) => (id === 'a' ? a : b),
      moveLocalTextStyleAfter: move,
    } as unknown as typeof figma);
    await expect(handler({ kind: 'TEXT', styleId: 'a', afterStyleId: 'b' })).rejects.toThrow(
      /same folder/,
    );
    await expect(handler({ kind: 'PAINT', styleId: 'a' })).rejects.toThrow(/kind mismatch/);
    a.remote = true;
    await expect(handler({ kind: 'TEXT', styleId: 'a' })).rejects.toThrow(/local/);
    expect(move).not.toHaveBeenCalled();
  });
});

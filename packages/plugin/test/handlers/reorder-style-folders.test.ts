import { describe, expect, it, vi } from 'vitest';

import { createReorderStyleFoldersHandler } from '../../src/handlers/reorder-style-folders.js';

describe('reorder_style_folders', () => {
  it.each(['Paint', 'Text', 'Effect', 'Grid', 'CustomAnimation'])(
    'moves %s folders by full paths, including ancestors containing descendants',
    async api => {
      const move = vi.fn<(...args: unknown[]) => void>();
      const ctx = {
        [`getLocal${api}StylesAsync`]: async () => [
          { name: 'Root/A/Deep/One' },
          { name: 'Root/B/Two' },
        ],
        [`moveLocal${api}FolderAfter`]: move,
      } as unknown as typeof figma;
      const kind = api === 'CustomAnimation' ? 'CUSTOM_ANIMATION' : api.toUpperCase();
      const handler = createReorderStyleFoldersHandler(ctx);
      await handler({ kind, folder: 'Root/A', afterFolder: 'Root/B' });
      expect(move).toHaveBeenLastCalledWith('Root/A', 'Root/B');
      await handler({ kind, folder: 'Root/B' });
      expect(move).toHaveBeenLastCalledWith('Root/B', null);
      await expect(handler({ kind, folder: 'Root/A', afterFolder: 'Other/B' })).rejects.toThrow(
        /sibling/,
      );
      await expect(handler({ kind, folder: 'Root/Absent' })).rejects.toThrow(/not found/);
    },
  );
});

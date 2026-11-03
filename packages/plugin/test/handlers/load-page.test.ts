import { describe, expect, it, vi } from 'vitest';

import { TimeSlice } from '../../src/cooperative.js';
import { createLoadPageHandler } from '../../src/handlers/load-page.js';

describe('load_page wall budget', () => {
  it.each([100_000, 105_000])(
    'returns completed pages at %i ms without starting another load',
    async elapsed => {
      let now = 0;
      const pages = Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        name: String(i),
        children: [],
        loadAsync: vi.fn<() => Promise<void>>(async () => {
          now += elapsed / 2;
        }),
      }));
      const api = { root: { children: pages } } as unknown as typeof figma;
      const result = await createLoadPageHandler(api, () => now)({ all: true });
      expect(result).toEqual({
        pages: pages
          .slice(0, 2)
          .map(p => ({ pageId: p.id, name: p.name, nodeCount: 0, loadMs: elapsed / 2 })),
        totalPages: 3,
        remaining: 1,
        success: true,
        stoppedBy: 'time budget',
      });
      expect(pages[2]!.loadAsync).not.toHaveBeenCalled();
    },
  );

  it('does not report a budget stop when the selected pages are complete', async () => {
    let now = 0;
    const page = {
      id: 'P',
      name: 'P',
      children: [],
      loadAsync: async () => {
        now = 105_000;
      },
    };
    const api = { currentPage: page } as unknown as typeof figma;
    expect(await createLoadPageHandler(api, () => now)({})).toEqual({
      pages: [{ pageId: 'P', name: 'P', nodeCount: 0, loadMs: 105_000 }],
      totalPages: 1,
      remaining: 0,
      success: true,
    });
  });

  it('includes host yield time before deciding whether to start the next page', async () => {
    let now = 0;
    const yieldSpy = vi.spyOn(TimeSlice.prototype, 'yield').mockImplementation(async () => {
      now = 100_000;
    });
    try {
      const pages = Array.from({ length: 2 }, (_, i) => ({
        id: String(i),
        name: String(i),
        children: [],
        loadAsync: vi.fn<() => Promise<void>>(async () => {}),
      }));
      const api = { root: { children: pages } } as unknown as typeof figma;
      expect(await createLoadPageHandler(api, () => now)({ all: true })).toMatchObject({
        remaining: 1,
        stoppedBy: 'time budget',
        pages: [{ pageId: '0' }],
      });
      expect(pages[1]!.loadAsync).not.toHaveBeenCalled();
    } finally {
      yieldSpy.mockRestore();
    }
  });
});

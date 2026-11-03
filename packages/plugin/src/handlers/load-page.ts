import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';

export const createLoadPageHandler =
  (api: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { pageId?: string; all?: boolean; limit?: number };
    if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100))
      throw new Error('load_page: limit must be an integer from 1 to 100');
    if (p.all && p.pageId !== undefined)
      throw new Error('load_page: pageId and all are mutually exclusive');
    const pages = p.all
      ? api.root.children
      : p.pageId === undefined
        ? [api.currentPage]
        : api.root.children.filter(page => page.id === p.pageId);
    if (pages.length === 0) throw new Error(`load_page: page not found: ${p.pageId}`);
    const selected = pages.slice(0, p.limit ?? 10);
    const slice = new TimeSlice(perfFor(api));
    const results = [];
    for (const page of selected) {
      const start = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop -- one page at a time, never loadAllPagesAsync
        await page.loadAsync();
        results.push({
          pageId: page.id,
          name: page.name,
          loadMs: Date.now() - start,
          nodeCount: page.children.length,
        });
      } catch (error) {
        results.push({
          pageId: page.id,
          name: page.name,
          loadMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      } finally {
        const perf = perfFor(api);
        if (perf) perf.pageLoadMs += Date.now() - start;
      }
      // eslint-disable-next-line no-await-in-loop -- let the editor and other requests run between pages
      if (results.length < selected.length) await slice.yield();
    }
    return {
      pages: results,
      totalPages: pages.length,
      remaining: pages.length - results.length,
      success: results.every(page => !('error' in page)),
    };
  };

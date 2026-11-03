import { afterEach, expect, it, vi } from 'vitest';

import { configureServerPerf, observeTool, serverPerfStats } from '../src/perf.js';
import { getPerfStatsTool, loadPageTool } from '../src/tools/perf.js';
afterEach(() => {
  configureServerPerf(false);
  serverPerfStats({ reset: true });
  vi.restoreAllMocks();
});
it('keeps tool schemas bounded with defaults', () => {
  expect(getPerfStatsTool.inputSchema.parse({})).toMatchObject({ limit: 50 });
  expect(loadPageTool.inputSchema.parse({})).toMatchObject({ limit: 10 });
  expect(getPerfStatsTool.inputSchema.safeParse({ limit: 201 }).success).toBe(false);
  expect(loadPageTool.inputSchema.safeParse({ limit: 101 }).success).toBe(false);
});
it('records total wall time and failure, excludes stats, preserves results', async () => {
  configureServerPerf(true);
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  const result = {};
  expect(
    await observeTool('read', async () => {
      now.mockReturnValue(130);
      return result;
    }),
  ).toBe(result);
  await expect(
    observeTool('fail', async () => {
      throw new Error('original');
    }),
  ).rejects.toThrow('original');
  await observeTool('get_perf_stats', async () => ({}));
  expect(serverPerfStats({ tool: 'read' })).toEqual([
    { tool: 'read', requestId: null, startedAt: 100, totalMs: 30, success: true },
  ]);
  expect(serverPerfStats({})[0]).toMatchObject({ tool: 'fail', success: false });
});

it('correlates concurrent dispatches and suppresses duplicate parent totals', async () => {
  configureServerPerf(true);
  await observeTool('parent', async () =>
    Promise.all([
      observeTool('get_node', async () => ({}), 'bridge-a'),
      observeTool('get_node', async () => ({}), 'bridge-b'),
    ]),
  );
  expect(
    serverPerfStats({})
      .map(row => row.requestId)
      .toSorted(),
  ).toEqual(['bridge-a', 'bridge-b']);
});

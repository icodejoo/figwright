import { AsyncLocalStorage } from 'node:async_hooks';

interface ServerCall {
  tool: string;
  requestId: string | null;
  startedAt: number;
  totalMs: number;
  success: boolean;
}
const context = new AsyncLocalStorage<{ dispatched: boolean }>();
let enabled = false;
const calls: Array<ServerCall | undefined> = Array.from({ length: 200 });
let cursor = 0;
let size = 0;
export const configureServerPerf = (value?: boolean): void => {
  if (value !== undefined) enabled = value;
};
export const observeTool = async <T>(
  tool: string,
  run: () => Promise<T>,
  requestId: string | null = null,
): Promise<T> => {
  if (!enabled || tool === 'get_perf_stats') return run();
  const parent = context.getStore();
  if (requestId !== null && parent) parent.dispatched = true;
  const box = { dispatched: false };
  const startedAt = Date.now();
  let success = false;
  try {
    const result = await context.run(box, run);
    success = !(
      typeof result === 'object' &&
      result !== null &&
      (('isError' in result && result.isError) || ('kind' in result && result.kind === 'err'))
    );
    return result;
  } finally {
    if (!box.dispatched) {
      calls[cursor] = { tool, requestId, startedAt, totalMs: Date.now() - startedAt, success };
      cursor = (cursor + 1) % 200;
      size = Math.min(size + 1, 200);
    }
  }
};
export const serverPerfStats = (params: { limit?: number; tool?: string; reset?: boolean }) => {
  const result = Array.from({ length: size }, (_, i) => calls[(cursor - 1 - i + 200) % 200]!)
    .filter(call => params.tool === undefined || call.tool === params.tool)
    .slice(0, params.limit ?? 50);
  if (params.reset) {
    size = 0;
    cursor = 0;
  }
  return result;
};

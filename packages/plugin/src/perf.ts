// Date.now is available in the sandbox; do not assume the browser performance global exists.
export interface PerfCall {
  id: string;
  tool: string;
  arrivedAt: number;
  startedAt: number;
  dispatchOverheadMs: number;
  handlerMs: number;
  byId: { count: number; totalMs: number; maxMs: number };
  pageLoadMs: number;
  yieldCount: number;
  yieldMs: number;
  traversalMs: number;
  serializationMs: number;
  /** Synchronous readExposure time; a subset of serializationMs. Do not add them. */
  exposureMs: number;
  /** Number of readExposure calls, including empty metadata and unavailable getters. */
  exposureCalls: number;
  success: boolean;
  error?: string;
}
let enabled = false;
let since = Date.now();
const buffer: Array<PerfCall | undefined> = Array.from({ length: 200 });
let size = 0;
let cursor = 0;
const contexts = new WeakMap<object, PerfCall>();
const apis = new WeakMap<PerfCall, typeof figma>();
export const lookupFor = (call: PerfCall): ((id: string) => Promise<BaseNode | null>) | undefined =>
  apis.get(call)?.getNodeByIdAsync;
export const bindPerf = (api: typeof figma, call: PerfCall): void => {
  contexts.set(api, call);
  apis.set(call, api);
};
export const perfFor = (api: object): PerfCall | undefined => contexts.get(api);
export const beginPerf = (id: string, tool: string): PerfCall | undefined => {
  if (!enabled || tool === 'get_perf_stats') return undefined;
  const now = Date.now();
  return {
    id,
    tool,
    arrivedAt: now,
    startedAt: now,
    dispatchOverheadMs: 0,
    handlerMs: 0,
    byId: { count: 0, totalMs: 0, maxMs: 0 },
    pageLoadMs: 0,
    yieldCount: 0,
    yieldMs: 0,
    traversalMs: 0,
    serializationMs: 0,
    exposureMs: 0,
    exposureCalls: 0,
    success: true,
  };
};
export const finishPerf = (call: PerfCall, error?: string): void => {
  call.handlerMs = Date.now() - call.startedAt;
  call.success = error === undefined;
  if (error !== undefined) call.error = error.slice(0, 120);
  buffer[cursor] = call;
  cursor = (cursor + 1) % 200;
  size = Math.min(size + 1, 200);
};
export const perfStats = (params: {
  limit?: number;
  tool?: string;
  reset?: boolean;
  enabled?: boolean;
}) => {
  if (params.enabled !== undefined) enabled = params.enabled;
  const calls = Array.from({ length: size }, (_, i) => buffer[(cursor - 1 - i + 200) % 200]!)
    .filter(call => params.tool === undefined || call.tool === params.tool)
    .slice(0, Math.min(200, Math.max(1, params.limit ?? 50)));
  const summary: Record<
    string,
    {
      count: number;
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
      byIdMs: number;
      exposureMs: number;
    }
  > = {};
  for (const tool of new Set(calls.map(call => call.tool))) {
    const rows = calls.filter(call => call.tool === tool);
    const times = rows.map(call => call.handlerMs).toSorted((a, b) => a - b);
    summary[tool] = {
      count: rows.length,
      p50Ms: times[Math.ceil(times.length * 0.5) - 1]!,
      p95Ms: times[Math.ceil(times.length * 0.95) - 1]!,
      maxMs: times[times.length - 1]!,
      byIdMs: rows.reduce((sum, row) => sum + row.byId.totalMs, 0),
      exposureMs: rows.reduce((sum, row) => sum + row.exposureMs, 0),
    };
  }
  const result = { calls, summary, bufferSize: size, since, enabled };
  if (params.reset) {
    buffer.fill(undefined);
    size = 0;
    cursor = 0;
    since = Date.now();
  }
  return result;
};
// A per-invocation API proxy: context survives awaits and concurrent calls without global async state.
export const withPerfApi = (api: typeof figma, call: PerfCall): typeof figma => {
  const proxy = new Proxy({} as typeof figma, {
    get: (_, key) => {
      const value: unknown = Reflect.get(api, key);
      if (key === 'loadAllPagesAsync')
        return async () => {
          const start = Date.now();
          try {
            return await api.loadAllPagesAsync();
          } finally {
            call.pageLoadMs += Date.now() - start;
          }
        };
      return typeof value === 'function' ? value.bind(api) : value;
    },
    set: (_, key, value) => Reflect.set(api, key, value),
    has: (_, key) => Reflect.has(api, key),
  });
  contexts.set(proxy, call);
  return proxy;
};

export const measureStage = <T>(
  perf: PerfCall | undefined,
  stage: 'traversalMs' | 'serializationMs',
  run: () => Promise<T>,
): Promise<T> => {
  if (!perf) return run();
  const start = Date.now();
  return run().finally(() => {
    perf[stage] += Date.now() - start;
  });
};

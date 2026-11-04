import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { childrenOf } from '../traverse.js';

// 64 overlaps native cross-thread lookups/page loads while bounding in-flight work and budget overshoot.
const MAIN_LOOKUP_BATCH_SIZE = 64;

export const createGetInstanceMainsHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      root?: string;
      scope?: 'topLevel' | 'all';
      nameContains?: string;
      limit?: number;
      timeBudgetMs?: number;
      includeTimings?: boolean;
    };
    const limit = p.limit ?? 2000;
    const budget = p.timeBudgetMs ?? 90_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20_000)
      throw new Error('get_instance_mains: limit must be an integer from 1 to 20000');
    if (!Number.isInteger(budget) || budget < 1 || budget > 100_000)
      throw new Error('get_instance_mains: timeBudgetMs must be an integer from 1 to 100000');
    if (p.scope !== undefined && p.scope !== 'topLevel' && p.scope !== 'all')
      throw new Error('get_instance_mains: scope must be topLevel or all');
    const deadline = now() + budget;
    const root = p.root === undefined ? api.currentPage : await api.getNodeByIdAsync(p.root);
    if (!root) throw new Error(`get_instance_mains: node not found: ${p.root}`);
    if (root.type === 'PAGE') await root.loadAsync();
    const stack: BaseNode[] = root.type === 'PAGE' ? root.children.toReversed() : [root];
    type Row = {
      instanceId: string;
      mainId: string | null;
      mainName?: string;
      setId?: string;
      setName?: string;
      orphan: boolean;
      missing?: true;
    };
    const instances: Row[] = [];
    const mains = new Map<
      string,
      { mainId: string; mainName: string; setName?: string; count: number; orphan: boolean }
    >();
    const counts = { instances: 0, orphan: 0, missing: 0 };
    const perf = perfFor(api);
    const timed = perf !== undefined || p.includeTimings === true;
    let traversalMs = 0;
    let lookupMs = 0;
    let concurrency = 0;
    const orphanById = new Map<string, boolean>();
    const slice = new TimeSlice(perf);
    let complete = true;
    let truncated = false;
    const needle = p.nameContains?.toLowerCase();
    while (stack.length) {
      if (now() >= deadline) {
        complete = false;
        break;
      }
      const batch: InstanceNode[] = [];
      const traversalStart = timed ? now() : 0;
      // Do not start lookups beyond the remaining result cap, even without a name filter.
      const batchLimit = Math.min(MAIN_LOOKUP_BATCH_SIZE, limit - instances.length);
      while (stack.length && batch.length < batchLimit) {
        if (now() >= deadline) {
          complete = false;
          break;
        }
        const node = stack.pop()!;
        if (node.type === 'INSTANCE' && (p.scope === 'all' || !node.id.startsWith('I')))
          batch.push(node);
        if (
          node.type !== 'PAGE' &&
          node.type !== 'DOCUMENT' &&
          (node.type !== 'INSTANCE' || p.scope === 'all')
        ) {
          const children = childrenOf(node);
          if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
        }
        // eslint-disable-next-line no-await-in-loop -- keep traversal cooperative even in forests without instances
        if (stack.length && slice.due()) await slice.yield();
      }
      if (timed) {
        const elapsed = now() - traversalStart;
        traversalMs += elapsed;
        if (perf) perf.traversalMs += elapsed;
      }
      if (!complete || !batch.length) break;
      const lookupStart = timed ? now() : 0;
      concurrency = Math.max(concurrency, batch.length);
      let resolved: (ComponentNode | null)[];
      try {
        // eslint-disable-next-line no-await-in-loop -- await one bounded concurrent batch before starting the next
        resolved = await Promise.all(batch.map(node => node.getMainComponentAsync()));
      } finally {
        if (timed) {
          const elapsed = now() - lookupStart;
          lookupMs += elapsed;
          if (perf) perf.mainLookupMs += elapsed;
        }
      }
      // Preserve traversal order regardless of completion order; drain resolved data even past deadline.
      for (let i = 0; i < batch.length; i += 1) {
        const node = batch[i]!;
        const main = resolved[i]!;
        const set = main?.parent?.type === 'COMPONENT_SET' ? main.parent : undefined;
        if (
          needle === undefined ||
          main?.name.toLowerCase().includes(needle) ||
          set?.name.toLowerCase().includes(needle)
        ) {
          let orphan = false;
          if (main) {
            const cached = orphanById.get(main.id);
            if (cached !== undefined) orphan = cached;
            else {
              let ancestor: BaseNode | null = main;
              while (ancestor && ancestor.type !== 'PAGE' && ancestor.type !== 'DOCUMENT')
                ancestor = ancestor.parent;
              orphan = ancestor === null;
              orphanById.set(main.id, orphan);
            }
          }
          const row: Row = main
            ? {
                instanceId: node.id,
                mainId: main.id,
                mainName: main.name,
                orphan,
                ...(set && { setId: set.id, setName: set.name }),
              }
            : { instanceId: node.id, mainId: null, orphan: false, missing: true };
          instances.push(row);
          counts.instances += 1;
          if (orphan) counts.orphan += 1;
          if (!main) counts.missing += 1;
          else {
            const existing = mains.get(main.id);
            if (existing) existing.count += 1;
            else
              mains.set(main.id, {
                mainId: main.id,
                mainName: main.name,
                ...(set && { setName: set.name }),
                count: 1,
                orphan,
              });
          }
          if (instances.length >= limit) {
            truncated = true;
            complete = false;
            break;
          }
        }
      }
      if (now() >= deadline) complete = false;
      if (!complete) break;
      // eslint-disable-next-line no-await-in-loop -- native waits may exhaust a slice, so yield between batches too
      if (stack.length && slice.due()) await slice.yield();
    }
    const distinctMains = [...mains.values()].toSorted((a, b) => b.count - a.count);
    return {
      ...(p.includeTimings === true && { timings: { traversalMs, lookupMs, concurrency } }),
      instances,
      distinctMains: distinctMains.slice(0, 500),
      counts,
      complete,
      truncated: truncated || distinctMains.length > 500,
    };
  };

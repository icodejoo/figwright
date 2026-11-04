import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { childrenOf } from '../traverse.js';

export const createGetInstanceMainsHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      root?: string;
      scope?: 'topLevel' | 'all';
      nameContains?: string;
      limit?: number;
      timeBudgetMs?: number;
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
    const slice = new TimeSlice(perfFor(api));
    let complete = true;
    let truncated = false;
    const needle = p.nameContains?.toLowerCase();
    while (stack.length) {
      if (now() >= deadline) {
        complete = false;
        break;
      }
      const node = stack.pop()!;
      if (node.type === 'INSTANCE' && (p.scope === 'all' || !node.id.startsWith('I'))) {
        // eslint-disable-next-line no-await-in-loop -- resolve each instance without serializing its subtree
        const main = await node.getMainComponentAsync();
        const set = main?.parent?.type === 'COMPONENT_SET' ? main.parent : undefined;
        if (
          needle === undefined ||
          main?.name.toLowerCase().includes(needle) ||
          set?.name.toLowerCase().includes(needle)
        ) {
          let ancestor: BaseNode | null = main;
          while (ancestor && ancestor.type !== 'PAGE' && ancestor.type !== 'DOCUMENT')
            ancestor = ancestor.parent;
          const orphan = main !== null && ancestor === null;
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
      if (node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
        const children = childrenOf(node);
        if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
      }
      // eslint-disable-next-line no-await-in-loop -- let Figma process host messages between traversal slices
      if (stack.length && slice.due()) await slice.yield();
    }
    const distinctMains = [...mains.values()].toSorted((a, b) => b.count - a.count);
    return {
      instances,
      distinctMains: distinctMains.slice(0, 500),
      counts,
      complete,
      truncated: truncated || distinctMains.length > 500,
    };
  };

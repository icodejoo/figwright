import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';

export const createListChildrenHandler =
  (api: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { nodeId: string; types?: string[] };
    const node = await api.getNodeByIdAsync(p.nodeId);
    if (!node) throw new Error(`list_children: node not found: ${p.nodeId}`);
    if (node.type === 'PAGE') await node.loadAsync();
    const direct = 'children' in node ? node.children : [];
    const children = [];
    let count = 0;
    const slice = new TimeSlice(perfFor(api));
    for (const [index, child] of direct.entries()) {
      if (!p.types || p.types.includes(child.type)) {
        count += 1;
        if (children.length < 5000)
          children.push({
            id: child.id,
            name: child.name,
            type: child.type,
            visible: 'visible' in child ? child.visible : true,
            index,
          });
      }
      // eslint-disable-next-line no-await-in-loop -- basic native getters also need cooperative host turns
      if (slice.due()) await slice.yield();
    }
    return {
      nodeId: node.id,
      children,
      count,
      ...(count > 5000 && {
        truncated: true,
        note: 'Only the first 5000 matching direct children are returned; narrow types to retrieve fewer children.',
      }),
    };
  };

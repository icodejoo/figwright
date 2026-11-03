import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { consumerLimit, consumerLocation } from './consumer-location.js';

/* eslint-disable no-await-in-loop -- bound native lookups and yield cooperatively between results */

export const createGetComponentInstancesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { componentId: string; limit?: number };
    const limit = consumerLimit(p.limit);
    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node?.type !== 'COMPONENT' && node?.type !== 'COMPONENT_SET') {
      throw new Error(
        `get_component_instances: ${p.componentId} is not a component or component set`,
      );
    }
    await figmaCtx.loadAllPagesAsync();
    const components = node.type === 'COMPONENT' ? [node] : node.children;
    const slice = new TimeSlice(perfFor(figmaCtx));
    const instances: (Awaited<ReturnType<typeof consumerLocation>> & { componentId: string })[] =
      [];
    const seen = new Set<string>();
    for (const component of components) {
      if (component.type !== 'COMPONENT') continue;
      const found = await component.getInstancesAsync();
      for (const instance of found) {
        if (slice.due()) await slice.yield();
        if (seen.has(instance.id)) continue;
        if (instances.length === limit) return { componentId: node.id, instances, truncated: true };
        seen.add(instance.id);
        instances.push({ ...(await consumerLocation(instance, slice)), componentId: component.id });
      }
      if (slice.due()) await slice.yield();
    }
    return { componentId: node.id, instances, truncated: false };
  };

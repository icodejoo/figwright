import type { BriefSearchNode } from '@figwright/shared';

import { TimeSlice } from './cooperative.js';
import type { PerfCall } from './perf.js';

export const validateBriefRead = (tool: string, p: { brief?: boolean; limit?: number }): void => {
  if (p.brief !== undefined && typeof p.brief !== 'boolean')
    throw new TypeError(`${tool}: brief must be a boolean`);
  if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 10000))
    throw new TypeError(`${tool}: limit must be an integer from 1 to 10000`);
};
export const briefNodes = async (
  nodes: readonly SceneNode[],
  perf?: PerfCall,
  text = false,
): Promise<Array<BriefSearchNode & { characters?: string }>> => {
  const out: Array<BriefSearchNode & { characters?: string }> = [];
  const slice = new TimeSlice(perf);
  for (const node of nodes) {
    out.push({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parent?.id ?? null,
      visible: node.visible,
      ...(text ? { characters: (node as TextNode | TextPathNode).characters } : {}),
    });
    // eslint-disable-next-line no-await-in-loop -- native getters need cooperative slices
    if (slice.due()) await slice.yield();
  }
  return out;
};

import { TimeSlice } from '../cooperative.js';

/* eslint-disable no-await-in-loop -- yield between main-thread slices while walking ancestors */

/** Paths use ids as well as names: duplicate layer names must not make references ambiguous. */
export const consumerLocation = async (node: SceneNode, slice: TimeSlice) => {
  const parentPath: { id: string; name: string; type: string }[] = [];
  let current = node.parent;
  let page: { id: string; name: string } | null = null;
  while (current !== null && current.type !== 'DOCUMENT') {
    parentPath.push({ id: current.id, name: current.name, type: current.type });
    if (current.type === 'PAGE') page = { id: current.id, name: current.name };
    current = current.parent;
    if (slice.due()) await slice.yield();
  }
  return {
    id: node.id,
    name: node.name,
    parentId: node.parent?.id ?? null,
    page,
    parentPath: parentPath.toReversed(),
  };
};

export const consumerLimit = (value: unknown): number => {
  if (value === undefined) return 1000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new TypeError('limit must be an integer between 1 and 10000');
  }
  return value;
};

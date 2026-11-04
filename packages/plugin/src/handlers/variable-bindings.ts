import { TimeSlice } from '../cooperative.js';
import { measureStage, perfFor } from '../perf.js';
import { childrenOf } from '../traverse.js';

const cachedLookup = <T extends { id: string }>(
  local: () => Promise<T[]>,
  fallback: (id: string) => Promise<T | null>,
) => {
  let locals: Promise<Map<string, T>> | undefined;
  const remote = new Map<string, Promise<T | null>>();
  return async (id: string): Promise<T | null> => {
    const values = await (locals ??= local().then(rows => new Map(rows.map(row => [row.id, row]))));
    if (values.has(id)) return values.get(id)!;
    if (!remote.has(id)) remote.set(id, fallback(id));
    return remote.get(id)!;
  };
};

// Keep native objects scoped to one tool call; local ID lookups can stall in Figma.
export const createVariableResolver = (api: typeof figma) => {
  return {
    resolve: cachedLookup(
      () => api.variables.getLocalVariablesAsync(),
      id => api.variables.getVariableByIdAsync(id),
    ),
    resolveCollection: cachedLookup(
      () => api.variables.getLocalVariableCollectionsAsync(),
      id => api.variables.getVariableCollectionByIdAsync(id),
    ),
  };
};

export type BindingGroup = 'fills' | 'strokes' | 'effects' | 'layoutGrids' | 'scalars';
export interface Binding {
  variableId: string;
  group: BindingGroup;
  field: string;
  key: string;
  index?: number;
  unsupported?: 'gradient' | 'textSegment' | 'scalarArray';
}
const aliases = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(aliases);
  if (value && typeof value === 'object') {
    const alias = value as { type?: string; id?: unknown };
    if (alias.type === 'VARIABLE_ALIAS' && typeof alias.id === 'string') return [alias.id];
    return Object.values(value).flatMap(aliases);
  }
  return [];
};

// These node fields summarize bindings held on individual objects/ranges. Count the canonical
// occurrences below, never both the summary and the underlying paint/effect/grid/text segment.
const MIRRORS = new Set(['fills', 'strokes', 'effects', 'layoutGrids', 'textRangeFills']);
export const readBindings = (api: typeof figma, node: SceneNode): Binding[] => {
  const out: Binding[] = [];
  if (node.removed) return out;
  const raw = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(node.boundVariables ?? {})) {
    if (MIRRORS.has(key)) continue;
    for (const variableId of aliases(value))
      out.push({
        variableId,
        group: 'scalars',
        field: `node.${key}`,
        key,
        ...(Array.isArray(value) && { unsupported: 'scalarArray' as const }),
      });
  }
  const paints = (value: unknown, group: 'fills' | 'strokes', segment = false) => {
    if (!Array.isArray(value)) return;
    const prefix = group === 'fills' ? 'fill' : 'stroke';
    value.forEach((paint: Paint, index) => {
      if (paint.type === 'SOLID') {
        for (const variableId of aliases(paint.boundVariables?.color))
          out.push({
            variableId,
            group,
            field: segment ? 'text.segment' : `${prefix}.color`,
            key: 'color',
            index,
            ...(segment && { unsupported: 'textSegment' as const }),
          });
      } else if ('gradientStops' in paint) {
        for (const stop of paint.gradientStops)
          for (const variableId of aliases(stop.boundVariables?.color))
            out.push({
              variableId,
              group,
              field: segment ? 'text.segment' : `${prefix}.gradient`,
              key: 'color',
              index,
              unsupported: segment ? 'textSegment' : 'gradient',
            });
      }
    });
  };
  paints(raw.fills, 'fills');
  paints(raw.strokes, 'strokes');
  if (node.type === 'TEXT' && raw.fills === api.mixed) {
    for (const segment of node.getStyledTextSegments(['fills']))
      paints(segment.fills, 'fills', true);
  }
  for (const group of ['effects', 'layoutGrids'] as const) {
    const objects = raw[group];
    if (!Array.isArray(objects)) continue;
    objects.forEach((object: { boundVariables?: Record<string, unknown> }, index) => {
      for (const [key, value] of Object.entries(object.boundVariables ?? {}))
        for (const variableId of aliases(value))
          out.push({
            variableId,
            group,
            field: `${group === 'effects' ? 'effect' : 'layoutGrid'}.${key}`,
            key,
            index,
          });
    });
  }
  return out;
};

export const bindingScope = async (api: typeof figma, root?: string) => {
  const node = root === undefined ? api.currentPage : await api.getNodeByIdAsync(root);
  if (!node || node.type === 'DOCUMENT') throw new Error(`Invalid root: ${root}`);
  if (node.type !== 'PAGE') return { root: node.id, nodes: [node as SceneNode] };
  const perf = perfFor(api);
  const start = perf ? Date.now() : 0;
  try {
    await (node as PageNode).loadAsync();
  } finally {
    if (perf) perf.pageLoadMs += Date.now() - start;
  }
  return { root: node.id, nodes: (node as PageNode).children };
};

const outerOverrides = (node: SceneNode) => {
  let outer: InstanceNode | undefined;
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'INSTANCE') outer = current;
    current = current.parent;
  }
  return outer ? new Map(outer.overrides.map(row => [row.id, row.overriddenFields])) : undefined;
};

export const visitBindings = async (
  api: typeof figma,
  roots: readonly SceneNode[],
  deadline: number,
  now: () => number,
  visit: (
    node: SceneNode,
    overrides?: Map<string, readonly string[]>,
    additional?: boolean,
  ) => Promise<void>,
  includeInstanceSublayers?: boolean,
  additionalRoot?: (node: SceneNode) => Promise<SceneNode | undefined>,
) =>
  measureStage(perfFor(api), 'traversalMs', async () => {
    const stack = roots.toReversed().map(node => ({
      node,
      overrides: undefined as Map<string, readonly string[]> | undefined,
      additional: false,
    }));
    const seen = new Set<string>();
    let skippedInstances = 0;
    const slice = new TimeSlice(perfFor(api));
    let visited = 0;
    while (stack.length) {
      if (now() >= deadline)
        return {
          visited,
          complete: false,
          ...(includeInstanceSublayers !== undefined && { skippedInstances }),
        };
      const entry = stack.pop()!;
      const node = entry.node;
      try {
        if (node.removed) continue;
        if (additionalRoot) {
          if (seen.has(node.id)) continue;
          seen.add(node.id);
        }
        const overrides =
          includeInstanceSublayers === undefined
            ? undefined
            : (entry.overrides ??
              outerOverrides(node) ??
              (node.id.startsWith('I') ? new Map<string, readonly string[]>() : undefined));
        // eslint-disable-next-line no-await-in-loop -- bounded per-node native reads/writes
        await visit(node, overrides, entry.additional);
        visited += 1;
        if (node.removed) continue;
        if (includeInstanceSublayers === false && node.type === 'INSTANCE') skippedInstances++;
        else {
          const children = childrenOf(node);
          if (children)
            for (let i = children.length - 1; i >= 0; i -= 1)
              stack.push({ node: children[i]!, overrides, additional: entry.additional });
        }
        if (additionalRoot) {
          // eslint-disable-next-line no-await-in-loop -- discover roots within the same budget and cooperative traversal
          const extra = await additionalRoot(node);
          if (extra && !seen.has(extra.id))
            stack.push({ node: extra, overrides: undefined, additional: true });
        }
      } catch {
        // Nodes may be removed by the user during a cooperative host handoff.
        // A stale native getter must not abort the remaining traversal.
      }
      // eslint-disable-next-line no-await-in-loop -- cooperative host handoff
      if (stack.length && slice.due()) await slice.yield();
    }
    return {
      visited,
      complete: additionalRoot ? now() < deadline : true,
      ...(includeInstanceSublayers !== undefined && { skippedInstances }),
    };
  });

// Assigning arrays detaches styles, including a mixed style across text ranges.
export const hasBindingStyle = (node: SceneNode, group: BindingGroup): boolean => {
  const key = { fills: 'fillStyleId', strokes: 'strokeStyleId', effects: 'effectStyleId' }[
    group as 'fills' | 'strokes' | 'effects'
  ];
  if (!key) return false;
  const value = (node as unknown as Record<string, unknown>)[key];
  return typeof value === 'symbol' || (typeof value === 'string' && value.length > 0);
};
export const isInheritedBinding = (
  node: SceneNode,
  field: string,
  overrides?: Map<string, readonly string[]>,
): boolean => overrides !== undefined && !overrides.get(node.id)?.includes(field);

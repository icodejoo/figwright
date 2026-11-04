import type { SandboxToolHandler } from '../dispatcher.js';
import { writePaints } from './paints.js';
import {
  type Binding,
  type BindingGroup,
  bindingScope,
  createVariableResolver,
  hasBindingStyle,
  isInheritedBinding,
  readBindings,
  visitBindings,
} from './variable-bindings.js';

const counts = () => ({ fills: 0, strokes: 0, effects: 0, layoutGrids: 0, scalars: 0 });
// Typings explicitly allow parentless remote or soft-deleted main components. Such a
// component is still writable if not removed; no document-tree walk can reach it. A main
// inside a detached component set is just as unreachable, so walk the whole parent chain
// and call it an orphan when the chain ends anywhere but a page.
const isOrphanMain = (node: ComponentNode): boolean => {
  if (node.removed) return false;
  let cur: BaseNode | null = node;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') cur = cur.parent;
  return cur === null;
};
export const createRebindVariablesHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      root?: string;
      mapping?: { from: string; to: string }[];
      dryRun?: boolean;
      includeInstanceSublayers?: boolean;
      includeOrphanMains?: boolean;
      fields?: BindingGroup[];
      timeBudgetMs?: number;
    };
    const budget = p.timeBudgetMs ?? 90_000;
    if (!Number.isInteger(budget) || budget < 1 || budget > 100_000)
      throw new Error('timeBudgetMs must be from 1 to 100000');
    if (!Array.isArray(p.mapping) || !p.mapping.length)
      throw new Error('mapping must contain at least one pair');
    const mapping = new Map<string, string>();
    for (const pair of p.mapping) {
      if (
        typeof pair.from !== 'string' ||
        typeof pair.to !== 'string' ||
        pair.from === pair.to ||
        mapping.has(pair.from)
      )
        throw new Error('mapping requires unique from ids and from != to');
      mapping.set(pair.from, pair.to);
    }
    const variables = new Map<string, Variable>();
    const resolver = createVariableResolver(api);
    // Resolve and validate the ENTIRE mapping before loading/traversing or performing any write.
    for (const id of new Set(p.mapping.flatMap(pair => [pair.from, pair.to]))) {
      // eslint-disable-next-line no-await-in-loop -- all variables validated before writes
      const variable = await resolver.resolve(id);
      if (!variable) throw new Error(`Variable not found: ${id}`);
      variables.set(id, variable);
    }
    for (const { from, to } of p.mapping)
      if (variables.get(from)!.resolvedType !== variables.get(to)!.resolvedType)
        throw new Error(`Variable type mismatch: ${from} -> ${to}`);
    const deadline = now() + budget;
    const scope = await bindingScope(api, p.root);
    const dryRun = p.dryRun ?? true;
    const fields = new Set<BindingGroup>(
      p.fields ?? ['fills', 'strokes', 'effects', 'layoutGrids'],
    );
    const matched = counts();
    const changed = counts();
    let skippedInherited = 0,
      skippedStyled = 0;
    const skippedStyledSamples: { nodeId: string; group: string }[] = [];
    const unsupported = {
      gradient: 0,
      textSegment: 0,
      scalarArray: 0,
      samples: [] as { nodeId: string; field: string; reason: string }[],
    };
    const failed: { nodeId: string; error: string }[] = [];
    let failedCount = 0;
    const changedSamples: { nodeId: string; field: string; from: string; to: string }[] = [];
    const perMapping = p.mapping.map(pair => ({ ...pair, count: 0 }));
    const perFrom = new Map(perMapping.map(row => [row.from, row]));
    const orphanMainIds = new Set<string>();
    const orphanMains = { visited: 0, count: 0, samples: [] as string[] };
    const recordFailure = (node: SceneNode, error: unknown) => {
      failedCount += 1;
      if (failed.length < 20)
        failed.push({
          nodeId: node.id,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 120),
        });
    };
    const traversal = await visitBindings(
      api,
      scope.nodes,
      deadline,
      now,
      async (node, overrides, additional) => {
        try {
          if (node.removed) return;
          if (additional) orphanMains.visited++;
          const styled = new Set<BindingGroup>();
          for (const group of fields)
            if (hasBindingStyle(node, group)) {
              styled.add(group as BindingGroup);
              skippedStyled++;
              if (skippedStyledSamples.length < 5)
                skippedStyledSamples.push({ nodeId: node.id, group });
            }
          const hits = readBindings(api, node).filter(
            binding =>
              fields.has(binding.group) &&
              mapping.has(binding.variableId) &&
              (p.fields !== undefined || binding.key === 'color'),
          );
          const supported: Binding[] = [];
          for (const binding of hits) {
            if (styled.has(binding.group)) continue;
            if (
              isInheritedBinding(
                node,
                binding.group === 'scalars' ? binding.key : binding.group,
                overrides,
              )
            ) {
              skippedInherited++;
              continue;
            }
            if (binding.unsupported) {
              unsupported[binding.unsupported] += 1;
              if (unsupported.samples.length < 20)
                unsupported.samples.push({
                  nodeId: node.id,
                  field: binding.field,
                  reason: binding.unsupported,
                });
            } else {
              supported.push(binding);
              matched[binding.group] += 1;
              perFrom.get(binding.variableId)!.count += 1;
            }
          }
          if (dryRun || !supported.length) return;
          const record = (bindings: Binding[]) => {
            for (const binding of bindings) {
              changed[binding.group] += 1;
              if (changedSamples.length < 50)
                changedSamples.push({
                  nodeId: node.id,
                  field: binding.field,
                  from: binding.variableId,
                  to: mapping.get(binding.variableId)!,
                });
            }
          };
          for (const group of ['fills', 'strokes', 'effects', 'layoutGrids', 'scalars'] as const) {
            const bindings = supported.filter(binding => binding.group === group);
            if (!bindings.length) continue;
            if (group === 'scalars') {
              for (const binding of bindings) {
                node.setBoundVariable(
                  binding.key as VariableBindableNodeField,
                  variables.get(mapping.get(binding.variableId)!)!,
                );
                record([binding]);
              }
            } else {
              const raw = node as unknown as Record<string, unknown>;
              const next = [...(raw[group] as unknown[])];
              for (const binding of bindings) {
                const index = binding.index!;
                const variable = variables.get(mapping.get(binding.variableId)!)!;
                if (group === 'fills' || group === 'strokes')
                  next[index] = api.variables.setBoundVariableForPaint(
                    next[index] as SolidPaint,
                    'color',
                    variable,
                  );
                else if (group === 'effects')
                  next[index] = api.variables.setBoundVariableForEffect(
                    next[index] as Effect,
                    binding.key as VariableBindableEffectField,
                    variable,
                  );
                else
                  next[index] = api.variables.setBoundVariableForLayoutGrid(
                    next[index] as LayoutGrid,
                    binding.key as VariableBindableLayoutGridField,
                    variable,
                  );
              }
              if (group === 'fills' || group === 'strokes') {
                // eslint-disable-next-line no-await-in-loop -- write each cloned array once; preserve paint setter policy
                await writePaints(node, group, next as Paint[]);
              } else raw[group] = next;
              record(bindings);
            }
          }
        } catch (error) {
          recordFailure(node, error);
        }
      },
      p.includeInstanceSublayers ?? false,
      p.includeOrphanMains
        ? async node => {
            if (node.type !== 'INSTANCE' || now() >= deadline) return;
            try {
              const main = await node.getMainComponentAsync();
              if (!main || !isOrphanMain(main) || orphanMainIds.has(main.id)) return;
              orphanMainIds.add(main.id);
              orphanMains.count++;
              if (orphanMains.samples.length < 5) orphanMains.samples.push(main.id);
              return main;
            } catch (error) {
              recordFailure(node, error);
              return;
            }
          }
        : undefined,
    );
    return {
      dryRun,
      root: scope.root,
      ...traversal,
      matched,
      changed,
      orphanMains,
      skippedInherited,
      skippedStyled,
      skippedStyledSamples,
      unsupported,
      failed,
      failedCount,
      changedSamples,
      perMapping,
      ...(!dryRun && {
        notice:
          'In-place modification. Rollback: call again with reversed mapping. Exact reversal requires one-to-one mapping and no pre-existing target bindings in scope. Retrying resumes only when target ids are not also source ids.',
      }),
    };
  };

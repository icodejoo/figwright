/* eslint-disable no-await-in-loop -- Sequential native calls preserve traversal budgets, alias dependencies and read-modify-write ordering. */
import type { SandboxToolHandler } from '../dispatcher.js';
import { writePaints } from './paints.js';
import {
  bindingScope,
  createVariableResolver,
  visitBindings,
  hasBindingStyle,
  isInheritedBinding,
} from './variable-bindings.js';
const scalarFields: readonly VariableBindableNodeField[] = [
  'height',
  'width',
  'itemSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'counterAxisSpacing',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'opacity',
  'gridRowGap',
  'gridColumnGap',
];
type Group = 'fills' | 'strokes' | 'effects' | 'scalars';
const counts = () => ({ fills: 0, strokes: 0, effects: 0, scalars: 0 });
type Color = { r: number; g: number; b: number; a: number };
const color = (v: unknown): Color | null => {
  if (!v || typeof v !== 'object') return null;
  const c = v as Color;
  return [c.r, c.g, c.b, c.a ?? 1].every(Number.isFinite)
    ? { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 }
    : null;
};
const allowed = (variable: Variable, scopes: VariableScope[]) =>
  variable.scopes.includes('ALL_SCOPES') || scopes.some(scope => variable.scopes.includes(scope));

export const createBindVariablesByValueHandler =
  (api: typeof figma, now: () => number = Date.now): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      root?: string;
      variableIds?: string[];
      modeId?: string;
      fields?: Group[];
      scalarFields?: VariableBindableNodeField[];
      tolerance?: number;
      includeInstanceSublayers?: boolean;
      dryRun?: boolean;
      timeBudgetMs?: number;
      onAmbiguous?: 'skip' | 'first';
    };
    if (!p.variableIds?.length) throw new Error('variableIds must contain at least one id');
    const budget = p.timeBudgetMs ?? 90000,
      tolerance = p.tolerance ?? 0;
    if (!Number.isInteger(budget) || budget < 1 || budget > 100000)
      throw new Error('timeBudgetMs must be from 1 to 100000');
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.01)
      throw new Error('tolerance must be from 0 to 0.01');
    const deadline = now() + budget;
    const resolver = createVariableResolver(api);
    const get = async (id: string) => {
      const v = await resolver.resolve(id);
      if (!v) throw new Error(`Variable not found: ${id}`);
      return v;
    };
    const resolve = async (initial: Variable): Promise<number | Color> => {
      const seen = new Set<string>();
      let v = initial;
      while (true) {
        if (now() >= deadline)
          throw new Error(
            'Time budget exhausted validating candidate variables; no writes performed',
          );
        if (seen.has(v.id)) throw new Error(`Variable alias cycle: ${v.id}`);
        seen.add(v.id);
        if (v.resolvedType !== initial.resolvedType)
          throw new Error(`Variable alias type mismatch: ${v.id}`);
        const collection = await resolver.resolveCollection(v.variableCollectionId);
        if (!collection) throw new Error(`Collection not found: ${v.variableCollectionId}`);
        const requested =
          v.variableCollectionId === initial.variableCollectionId ? p.modeId : undefined;
        const mode =
          requested && v.valuesByMode[requested] !== undefined
            ? requested
            : collection.defaultModeId;
        const value = v.valuesByMode[mode];
        if (value === undefined) throw new Error(`Mode ${mode} not found on variable ${v.id}`);
        if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
          v = await get(value.id);
          continue;
        }
        if (initial.resolvedType === 'FLOAT' && typeof value === 'number' && Number.isFinite(value))
          return value;
        const c = color(value);
        if (initial.resolvedType === 'COLOR' && c) return c;
        throw new Error(`Invalid literal value: ${v.id}`);
      }
    };
    const candidates: { variable: Variable; value: number | Color }[] = [];
    for (const id of new Set(p.variableIds)) {
      const variable = await get(id);
      if (variable.resolvedType !== 'COLOR' && variable.resolvedType !== 'FLOAT')
        throw new Error(`Candidate must be COLOR or FLOAT: ${id}`);
      candidates.push({ variable, value: await resolve(variable) });
    }
    // Exact scalar lookup and RGB bucket index; tolerance uses the same candidate order without quantization.
    const scalars = new Map<number, typeof candidates>();
    const colors = candidates.filter(c => typeof c.value !== 'number');
    const exactColors = new Map<string, typeof candidates>();
    const key = (c: Color) => [c.r, c.g, c.b, c.a].join(',');
    for (const c of candidates) {
      if (typeof c.value === 'number') {
        const list = scalars.get(c.value) ?? [];
        list.push(c);
        scalars.set(c.value, list);
      } else {
        const k = key(c.value),
          list = exactColors.get(k) ?? [];
        list.push(c);
        exactColors.set(k, list);
      }
    }
    const matched = counts(),
      changed = counts();
    let ambiguous = 0,
      skippedAlpha = 0,
      skippedInherited = 0,
      skippedStyled = 0,
      failedCount = 0;
    const skippedStyledSamples: { nodeId: string; group: string }[] = [];
    const failed: { nodeId: string; error: string }[] = [],
      changedSamples: { nodeId: string; field: string; variableId: string }[] = [];
    const perVariable = candidates.map(c => ({
      variableId: c.variable.id,
      name: c.variable.name,
      count: 0,
    }));
    const perId = new Map(perVariable.map(c => [c.variableId, c]));
    const select = (value: number | Color, scopes: VariableScope[]) => {
      let hits: typeof candidates;
      if (typeof value === 'number') hits = scalars.get(value) ?? [];
      else {
        const rgb = colors.filter(c => {
          if (!allowed(c.variable, scopes)) return false;
          const v = c.value as Color;
          return ['r', 'g', 'b'].every(
            k => Math.abs(v[k as keyof Color] - value[k as keyof Color]) <= tolerance,
          );
        });
        hits =
          tolerance === 0
            ? (exactColors.get(key(value)) ?? [])
            : rgb.filter(c => Math.abs((c.value as Color).a - value.a) <= tolerance);
        if (!hits.length && value.a !== 1 && rgb.length) skippedAlpha++;
      }
      hits = hits.filter(c => allowed(c.variable, scopes));
      if (hits.length > 1) {
        ambiguous++;
        if ((p.onAmbiguous ?? 'skip') === 'skip') return undefined;
      }
      return hits[0];
    };
    const dryRun = p.dryRun ?? true,
      fields = new Set(p.fields ?? ['fills', 'strokes']);
    const hit = (group: Group, value: number | Color, scopes: VariableScope[]) => {
      const c = select(value, scopes);
      if (c) {
        matched[group]++;
        perId.get(c.variable.id)!.count++;
      }
      return c;
    };
    const scope = await bindingScope(api, p.root);
    const traversal = await visitBindings(
      api,
      scope.nodes,
      deadline,
      now,
      async (node, overrides) => {
        const raw = node as unknown as Record<string, unknown>;
        const record = (group: Group, field: string, variable: Variable) => {
          changed[group]++;
          if (changedSamples.length < 50)
            changedSamples.push({ nodeId: node.id, field, variableId: variable.id });
        };
        const failure = (error: unknown) => {
          failedCount++;
          if (failed.length < 20)
            failed.push({
              nodeId: node.id,
              error: (error instanceof Error ? error.message : String(error)).slice(0, 120),
            });
        };
        for (const group of ['fills', 'strokes', 'effects'] as const) {
          if (!fields.has(group)) continue;
          try {
            if (node.removed) return;
            if (hasBindingStyle(node, group)) {
              skippedStyled++;
              if (skippedStyledSamples.length < 5)
                skippedStyledSamples.push({ nodeId: node.id, group });
              continue;
            }
            if (isInheritedBinding(node, group, overrides)) {
              skippedInherited++;
              continue;
            }
            if (!Array.isArray(raw[group])) continue;
            const next = [...(raw[group] as (Paint | Effect)[])];
            const changes: { field: string; variable: Variable }[] = [];
            next.forEach((object, index) => {
              const obj = object as unknown as Record<string, unknown>;
              const bound = (obj.boundVariables ?? {}) as Record<string, unknown>;
              const keys =
                group === 'effects'
                  ? ['color', 'radius', 'spread', 'offsetX', 'offsetY']
                  : object.type === 'SOLID'
                    ? ['color']
                    : [];
              for (const field of keys) {
                if (bound[field] !== undefined) continue;
                const value =
                  field === 'color'
                    ? color({
                        ...(obj.color as object),
                        a:
                          group === 'effects' ? ((obj.color as Color)?.a ?? 1) : (obj.opacity ?? 1),
                      })
                    : field === 'offsetX' || field === 'offsetY'
                      ? (obj.offset as { x: number; y: number } | undefined)?.[
                          field === 'offsetX' ? 'x' : 'y'
                        ]
                      : obj[field];
                if (typeof value !== 'number' && !color(value)) continue;
                const scopes: VariableScope[] =
                  field !== 'color'
                    ? ['EFFECT_FLOAT']
                    : group === 'effects'
                      ? ['EFFECT_COLOR']
                      : group === 'strokes'
                        ? ['STROKE_COLOR']
                        : [
                            'ALL_FILLS',
                            node.type === 'TEXT'
                              ? 'TEXT_FILL'
                              : ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(
                                    node.type,
                                  )
                                ? 'FRAME_FILL'
                                : 'SHAPE_FILL',
                          ];
                const c = hit(group, value as number | Color, scopes);
                if (!c) continue;
                if (!dryRun) {
                  next[index] =
                    group === 'effects'
                      ? api.variables.setBoundVariableForEffect(
                          next[index] as Effect,
                          field as VariableBindableEffectField,
                          c.variable,
                        )
                      : api.variables.setBoundVariableForPaint(
                          next[index] as SolidPaint,
                          'color',
                          c.variable,
                        );
                  changes.push({ field: `${group}[${index}].${field}`, variable: c.variable });
                }
              }
            });
            if (changes.length) {
              if (group === 'effects') raw.effects = next;
              else await writePaints(node, group, next as Paint[]);
              for (const c of changes) record(group, c.field, c.variable);
            }
          } catch (error) {
            failure(error);
          }
        }
        if (fields.has('scalars'))
          for (const field of p.scalarFields ??
            scalarFields.filter(
              candidateField => !['width', 'height', 'opacity'].includes(candidateField),
            )) {
            try {
              if (node.removed) return;
              if (isInheritedBinding(node, field, overrides)) {
                skippedInherited++;
                continue;
              }
              const gap =
                field.startsWith('padding') ||
                ['itemSpacing', 'counterAxisSpacing', 'gridRowGap', 'gridColumnGap'].includes(
                  field,
                );
              if (
                gap &&
                (field.startsWith('grid')
                  ? raw.layoutMode !== 'GRID'
                  : !['HORIZONTAL', 'VERTICAL', 'GRID'].includes(String(raw.layoutMode)))
              )
                continue;
              if (
                field.startsWith('stroke') &&
                (!Array.isArray(raw.strokes) ||
                  !raw.strokes.some(
                    (paint: Paint) => paint.visible !== false && paint.opacity !== 0,
                  ))
              )
                continue;
              // The aggregate radius/stroke binding and per-side bindings overlap; never overwrite either form.
              const bound = node.boundVariables as Record<string, unknown> | undefined;
              if (field === 'cornerRadius' && typeof raw.topLeftRadius === 'number') continue;
              if (field === 'strokeWeight' && typeof raw.strokeTopWeight === 'number') continue;
              const family = field.endsWith('Radius')
                ? [field, 'cornerRadius']
                : field.startsWith('stroke') && field.endsWith('Weight')
                  ? [field, 'strokeWeight']
                  : [field];
              if (family.some(k => bound?.[k] !== undefined) || typeof raw[field] !== 'number')
                continue;
              const scopes: VariableScope[] = [
                field.endsWith('Radius')
                  ? 'CORNER_RADIUS'
                  : field.startsWith('stroke')
                    ? 'STROKE_FLOAT'
                    : field === 'opacity'
                      ? 'OPACITY'
                      : gap
                        ? 'GAP'
                        : 'WIDTH_HEIGHT',
              ];
              const c = hit('scalars', raw[field] as number, scopes);
              if (c && !dryRun) {
                node.setBoundVariable(field, c.variable);
                record('scalars', field, c.variable);
              }
            } catch (error) {
              failure(error);
            }
          }
      },
      p.includeInstanceSublayers ?? false,
    );
    return {
      dryRun,
      root: scope.root,
      ...traversal,
      matched,
      changed,
      ambiguous,
      skippedAlpha,
      skippedInherited,
      skippedStyled,
      skippedStyledSamples,
      failed,
      failedCount,
      perVariable,
      changedSamples,
    };
  };

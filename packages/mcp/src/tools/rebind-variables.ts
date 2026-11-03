import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const rebindVariablesTool: ToolSpec = {
  name: 'rebind_variables',
  kind: 'write',
  description:
    'Rebind variables across a subtree directly in the plugin sandbox, without serializing nodes. dryRun defaults to true: reports supported matched bindings with zero writes and changed all zero. root omitted means current page; pages load first. mapping must contain at least one {from,to}, unique from ids, from != to; every variable must exist and each pair must have identical resolvedType, validated before any write. includeInstanceSublayers defaults to false: do not descend into INSTANCE subtrees; skippedInstances counts those instances. Instance roots and sublayers process only fields listed in the outermost instance overrides; skippedInherited counts inherited bindings. Process main component pages before screens to avoid diverging from main components. Styled fills/strokes/effects (including mixed style ids) are skipped; skippedStyled counts groups, skippedStyledSamples contains at most 5 node/group samples. cornerRadius binding on nodes with independent corners appears as bindings on all four corners. fields omitted processes only color bindings in fills/strokes/effects/layoutGrids; explicit fields selects all bindings in those groups, and scalars MUST be explicitly selected. SOLID paints use setBoundVariableForPaint and the existing paint setter policy (variable alpha may replace opacity). Caller must ensure equal resolved values; this tool does not check visual equivalence. Gradient stops, mixed TEXT fill segments (font loading/range writes intentionally unsupported) and scalar arrays are counted in unsupported with node samples, never written. Untouched nodes receive zero writes. With dryRun:false this is in-place modification, NOT atomic and NOT batchable. Rollback = call again with reversed mapping; exact rollback requires one-to-one mapping and no pre-existing target bindings in scope. With disjoint source and target ids, repeated calls naturally resume: already rebound bindings no longer match from. Chains/cycles do not have this idempotence guarantee. timeBudgetMs defaults to 90000, maximum 100000 within the 120-second heavy budget; returns complete:false with prior writes retained on time exhaustion. In-flight native calls/host yields cannot be cancelled. Failures retain successful earlier fields and continue to later nodes. Returns {dryRun,root,visited,complete,matched:{fills,strokes,effects,layoutGrids,scalars},changed:{same keys},skippedInstances,skippedInherited,skippedStyled,skippedStyledSamples,unsupported:{gradient,textSegment,scalarArray,samples},failed:[{nodeId,error}],failedCount,changedSamples:[{nodeId,field,from,to}],perMapping:[{from,to,count}],notice?}. matched/perMapping count supported attempts (including failed writes); changed counts successful writes. failed returns at most 20 nodes/errors (first 120 characters), changedSamples at most 50. Timing is recorded under traversalMs, including binding reads/writes and host waits; no full node serialization.',
  inputSchema: z.object({
    root: z.string().optional(),
    mapping: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .min(1)
      .superRefine((pairs, ctx) => {
        const seen = new Set<string>();
        for (const [index, pair] of pairs.entries()) {
          if (pair.from === pair.to || seen.has(pair.from))
            ctx.addIssue({
              code: 'custom',
              path: [index, 'from'],
              message: 'from must be unique and differ from to',
            });
          seen.add(pair.from);
        }
      }),
    dryRun: z.boolean().default(true),
    includeInstanceSublayers: z.boolean().default(false),
    fields: z.array(z.enum(['fills', 'strokes', 'effects', 'layoutGrids', 'scalars'])).optional(),
    timeBudgetMs: z.number().int().min(1).max(100000).default(90000),
  }),
};

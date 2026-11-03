import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const bindVariablesByValueTool: ToolSpec = {
  name: 'bind_variables_by_value',
  kind: 'write',
  description:
    'Bind unbound SOLID paint colors and numeric fields to equal-valued COLOR/FLOAT candidate variables. variableIds requires at least one candidate; all candidates and alias chains are validated before writes; cycles and invalid types fail. modeId omitted uses each collection default mode (including alias targets); explicit modeId applies only in the candidate collection and falls back to the default when absent; alias targets in other collections always use their default mode. root omitted means current page. fields defaults to fills/strokes; effects supports shadow color and numeric radius/spread/offsets, scalars supports numeric VariableBindableNodeField properties. Existing bindings are never changed; mixed TEXT paints are skipped. tolerance defaults to 0, max 0.01, absolute per RGBA channel; scalar matching is exact. Paint opacity is compared as alpha because binding replaces opacity with variable alpha; unmatched nonopaque colors increment skippedAlpha. includeInstanceSublayers defaults false (do not descend into INSTANCE subtrees; skippedInstances counts these instances); instance roots and sublayers process only fields listed in the outermost instance overrides; skippedInherited counts inherited fields. Process main component pages before screens to avoid diverging from main components. dryRun defaults true with zero writes. onAmbiguous defaults skip (count ambiguous); first selects the first input candidate. timeBudgetMs defaults 90000, max 100000; cooperative partial results complete:false retain prior writes. Native operations cannot be interrupted. NOT atomic or batchable: subtree writes have no per-operation inverse. Repeating a successful call is idempotent. Returns {dryRun,root,visited,complete,matched:{fills,strokes,effects,scalars},changed:{same},ambiguous,skippedAlpha,skippedInstances,skippedInherited,skippedStyled,skippedStyledSamples,failed,failedCount,perVariable:[{variableId,name,count}],changedSamples:[{nodeId,field,variableId}]}; counts are attempts, changed only successful writes; samples capped at 50, failures at 20 (errors truncated to 120 characters). Styled fills/strokes/effects, including mixed style ids, are skipped; skippedStyled counts groups with at most 5 node/group samples. Candidate scopes must allow the destination field. Scalars exclude width/height/opacity by default; scalarFields explicitly selects a whitelist (including these high-risk fields) within the scalars group. Padding and spacing require active auto layout; grid gaps require GRID; stroke weights require visible strokes. cornerRadius binding on nodes with independent corners appears as bindings on all four corners. Uses heavy budget.',
  inputSchema: z.object({
    root: z.string().optional(),
    variableIds: z.array(z.string()).min(1),
    modeId: z.string().optional(),
    fields: z.array(z.enum(['fills', 'strokes', 'effects', 'scalars'])).optional(),
    scalarFields: z
      .array(
        z.enum([
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
        ]),
      )
      .optional(),
    tolerance: z.number().min(0).max(0.01).default(0),
    includeInstanceSublayers: z.boolean().default(false),
    dryRun: z.boolean().default(true),
    timeBudgetMs: z.number().int().min(1).max(100000).default(90000),
    onAmbiguous: z.enum(['skip', 'first']).default('skip'),
  }),
};

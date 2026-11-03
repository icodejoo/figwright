import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const scanVariableBindingsTool: ToolSpec = {
  name: 'scan_variable_bindings',
  kind: 'read',
  description:
    'Scan variable bindings directly in the plugin sandbox without serializing nodes or modifying the design. root omitted means current page; pages are loaded first. variableIds and collectionIds are intersecting optional filters; unresolved remote variables cannot pass a collection filter. sampleLimit defaults to 3 (0–20) distinct editable node ids per variable. Returns {root,visited,complete,bindings:[{variableId,name?,collectionName?,count,editable,nested,fields,samples}]}. Nested means node id starts with I. Counts canonical paint colors, gradient stops, mixed TEXT fill segments, effects, layout grids and node scalar bindings; node-level paint/effect/grid/range mirrors are excluded. Fields include fill.color, stroke.color, fill.gradient, stroke.gradient, text.segment, effect.<field>, layoutGrid.<field>, node.<field>. cornerRadius binding on nodes with independent corners appears as bindings on all four corners. TEXT segments are read only when fills is mixed. Variable/collection metadata is cached and may be absent if unavailable or time runs out. Stops starting nodes after 100 seconds and returns partial counts with complete:false; native async operations and host yields cannot be interrupted. Large bindings results are sorted by count and trimmed with truncated:true; narrow root/variableIds/collectionIds to retrieve omitted entries. Uses the 120-second heavy tool budget.',
  inputSchema: z.object({
    root: z.string().optional(),
    variableIds: z.array(z.string()).optional(),
    collectionIds: z.array(z.string()).optional(),
    sampleLimit: z.number().int().min(0).max(20).default(3),
  }),
};

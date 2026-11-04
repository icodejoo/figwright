import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const getInstanceMainsTool: ToolSpec = {
  name: 'get_instance_mains',
  kind: 'read',
  description:
    'Map instances to main components without node serialization. Resolves mains concurrently in bounded batches; includeTimings:true adds timings {traversalMs,lookupMs,concurrency}, with concurrency the maximum batch width used. root omitted means current page; pages load first. scope topLevel excludes ids starting with I and skips instance subtrees; all includes nested instances. nameContains filters main or component set names case-insensitively. Returns instances [{instanceId,mainId,mainName?,setId?,setName?,orphan,missing?}], distinctMains [{mainId,mainName,setName?,count,orphan}] sorted by count (up to 500), counts {instances,orphan,missing}, complete and truncated. orphan means a main cannot reach PAGE or DOCUMENT through parents; null mainId means missing:true and orphan:false. limit stops scanning; timeBudgetMs stops starting nodes and returns complete:false with partial counts, retaining resolved batches. Native async operations and host yields cannot be interrupted. Result budget trims instances while preserving aggregates. Uses the heavy tool budget.',
  inputSchema: z.object({
    root: z.string().optional(),
    scope: z.enum(['topLevel', 'all']).default('topLevel'),
    nameContains: z.string().optional(),
    limit: z.number().int().min(1).max(20000).default(2000),
    timeBudgetMs: z.number().int().min(1).max(100000).default(90000),
    includeTimings: z.boolean().default(false),
  }),
};

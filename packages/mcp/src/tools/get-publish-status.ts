import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const getPublishStatusTool: ToolSpec = {
  name: 'get_publish_status',
  kind: 'read',
  description:
    'Read publication status only; cannot publish. CHANGED means local unpublished changes: republish in the Figma UI. Component status is meaningful only for local components; remote objects are skipped and counted. kind defaults to VARIABLE_COLLECTION; ids omitted scans all local objects of that kind. Components are restricted to root/current page even with ids. root is rejected for variables/styles/ALL_LOCAL. ALL_LOCAL includes collections, variables, four style types and current-page components, with countsByKind. counts are before statuses filtering and limit, and cover only inspected objects when complete:false. limit defaults to 500, max 5000; truncated marks omitted matching items. Cooperative 100-second traversal returns partial results with complete:false; native calls cannot be interrupted. Returns {kind,items:[{id,name,type,status,key?,hiddenFromPublishing?}],counts,countsByKind,skippedRemote,failed:[{id,error}],failedCount,notFound,complete,truncated?}. Individual failures continue with at most 20 failed entries and 120 characters per error. notFound lists requested ids not found in the inspected scope (may include unvisited ids when complete:false). Uses heavy budget.',
  inputSchema: z.object({
    kind: z
      .enum(['VARIABLE_COLLECTION', 'VARIABLE', 'COMPONENT', 'COMPONENT_SET', 'STYLE', 'ALL_LOCAL'])
      .default('VARIABLE_COLLECTION'),
    ids: z.array(z.string()).optional(),
    root: z.string().optional(),
    statuses: z.array(z.enum(['UNPUBLISHED', 'CURRENT', 'CHANGED'])).optional(),
    limit: z.number().int().min(1).max(5000).default(500),
  }),
};

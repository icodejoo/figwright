import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const getComponentInstancesTool: ToolSpec = {
  name: 'get_component_instances',
  description:
    'Find instances of a COMPONENT or every variant of a COMPONENT_SET using getInstancesAsync, without scanning every node. Loads all pages; large files may take time or fail to load. Returns instances with id, componentId, page, parentId and parentPath (page to parent), plus truncated. limit defaults to 1000 (max 10000); truncated means more results exist, not that there are no more references. Requires an accessible component id; missing or wrong node types fail.',
  inputSchema: z.object({
    componentId: z.string().describe('Component or component-set node id'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum returned instances; default 1000'),
  }),
  kind: 'read',
};

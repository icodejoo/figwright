import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const setExposedInstanceTool: ToolSpec = {
  name: 'set_exposed_instance',
  description:
    'Expose or unexpose a primary nested instance so its component properties appear in the ' +
    'containing component’s instance panel. Only writable on primary INSTANCE nodes contained ' +
    'within a local COMPONENT or COMPONENT_SET, including through frames/groups. Instances inside ' +
    'another INSTANCE inherit exposure and cannot be edited here; edit the source in the main ' +
    'component instead. Missing nodes, non-instances, standalone instances and inherited nested ' +
    'instances fail; Figma write errors are reported verbatim. Supports batch with rollback. ' +
    'Returns { ok, nodeId }. For multiple nodes use one op per node in batch (one result per op). ' +
    'Requires a plugin build with set_exposed_instance support; older plugins return METHOD_NOT_FOUND.',
  inputSchema: z.object({
    nodeId: z.string().describe('Primary nested instance node id in the main component'),
    exposed: z.boolean().describe('true to expose, false to unexpose'),
  }),
  kind: 'write',
};

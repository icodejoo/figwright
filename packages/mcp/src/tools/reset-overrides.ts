import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const resetOverridesTool: ToolSpec = {
  name: 'reset_overrides',
  description:
    'Remove all direct overrides on an INSTANCE with removeOverrides(). recursive (default false) also resets nested instances, resolving children after each reset because reset may change the subtree. Requires an instance id; unavailable main components or unsupported editors may fail. Destructive: swapped/slot content and node ids may change; no faithful batch inverse exists. Does not use the deprecated resetOverrides API.',
  inputSchema: z.object({
    instanceId: z.string().describe('Instance node id'),
    recursive: z.boolean().optional().describe('Also reset nested instances; default false'),
  }),
  kind: 'write',
  destructive: true,
};

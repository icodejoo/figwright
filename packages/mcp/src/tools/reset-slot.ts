import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const resetSlotTool: ToolSpec = {
  name: 'reset_slot',
  description:
    'Reset a SLOT node to its original main-component content using resetSlot(). Custom slot children may be deleted; their ids cannot be restored, so this tool is not batchable. Requires an actual SLOT id in an instance; wrong types or unsupported contexts fail. Availability depends on plan and editor; API failure reasons are returned unchanged. 可用性取决于套餐与编辑器，失败原因会原样返回。',
  inputSchema: z.object({
    nodeId: z.string().describe('Slot node id to restore to its original content'),
  }),
  kind: 'write',
  destructive: true,
};

import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const saveVersionTool: ToolSpec = {
  name: 'save_version',
  description:
    'Save named version history after waiting one second for pending changes. Figma does not guarantee all preceding edits are included. Returns {version: {id} | null}. Starter availability and retention untested. Not batchable: history cannot be removed by the plugin API.',
  inputSchema: z.object({ title: z.string().min(1), description: z.string().optional() }),
  kind: 'write',
};

import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const setAspectRatioLockTool: ToolSpec = {
  name: 'set_aspect_ratio_lock',
  description:
    'Lock current width/height ratio or unlock it. Requires a resizable node; auto-resizing text (textAutoResize other than NONE) is unsupported. Figma errors are returned unchanged. Not batchable: targetAspectRatio is read-only, so an arbitrary previous ratio cannot be reliably restored.',
  inputSchema: z.object({ nodeId: z.string(), locked: z.boolean() }),
  kind: 'write',
};

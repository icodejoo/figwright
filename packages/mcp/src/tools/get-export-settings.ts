import { z } from 'zod';

import type { ToolSpec } from './spec.js';
export const getExportSettingsTool: ToolSpec = {
  name: 'get_export_settings',
  description:
    'Read saved export presets on an exportable node. Returns {nodeId,settings}. Media presets are returned as stored; set_export_settings currently accepts PNG/JPG/SVG/PDF only.',
  inputSchema: z.object({ nodeId: z.string() }),
  kind: 'read',
};

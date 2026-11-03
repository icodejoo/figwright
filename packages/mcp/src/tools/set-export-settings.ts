import { z } from 'zod';

import { exportSettingSchema } from './export-settings-schema.js';
import type { ToolSpec } from './spec.js';
export const setExportSettingsTool: ToolSpec = {
  name: 'set_export_settings',
  description:
    'Replace saved export presets on an exportable node; [] clears presets. PNG/JPG accept constraint; SVG accepts svgOutlineText/svgIdAttribute/svgSimplifyStroke; PDF accepts common options only. Invalid format-specific options are rejected. Figma restrictions are returned unchanged.',
  inputSchema: z.object({ nodeId: z.string(), settings: z.array(exportSettingSchema) }),
  kind: 'write',
};

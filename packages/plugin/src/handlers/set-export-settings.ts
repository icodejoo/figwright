import type { SandboxToolHandler } from '../dispatcher.js';
import { validateExportOptions } from './export-settings.js';
export const createSetExportSettingsHandler =
  (ctx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { nodeId: string; settings: ExportSettings[] };
    const n = await ctx.getNodeByIdAsync(p.nodeId);
    if (n === null || !('exportSettings' in n))
      throw new Error('set_export_settings: node not found or not exportable');
    for (const setting of p.settings) validateExportOptions(setting.format, setting);
    n.exportSettings = p.settings;
    return { ok: true, nodeId: n.id };
  };

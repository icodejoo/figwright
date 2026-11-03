import type { SandboxToolHandler } from '../dispatcher.js';
export const createGetExportSettingsHandler =
  (ctx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { nodeId: string };
    const n = await ctx.getNodeByIdAsync(p.nodeId);
    if (n === null || !('exportSettings' in n))
      throw new Error('get_export_settings: node not found or not exportable');
    return { nodeId: n.id, settings: n.exportSettings };
  };

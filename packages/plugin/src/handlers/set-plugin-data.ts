import type { SandboxToolHandler } from '../dispatcher.js';
import { pluginDataTarget, writePluginData, type PluginDataParams } from './plugin-data.js';
export const createSetPluginDataHandler =
  (ctx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as PluginDataParams;
    const t = await pluginDataTarget(ctx, p);
    writePluginData(t, p, p.value!);
    return { ok: true };
  };

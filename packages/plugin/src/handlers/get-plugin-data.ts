import type { SandboxToolHandler } from '../dispatcher.js';
import { pluginDataTarget, readPluginData, type PluginDataParams } from './plugin-data.js';
export const createGetPluginDataHandler =
  (ctx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as PluginDataParams;
    const t = await pluginDataTarget(ctx, p);
    if (p.key !== undefined) return { value: readPluginData(t, p, p.key) };
    const keys =
      p.namespace === undefined ? t.getPluginDataKeys() : t.getSharedPluginDataKeys(p.namespace);
    return { data: Object.fromEntries(keys.map(key => [key, readPluginData(t, p, key)])) };
  };

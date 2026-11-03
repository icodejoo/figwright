import type { SandboxToolHandler } from '../dispatcher.js';
export const createSetAspectRatioLockHandler =
  (ctx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { nodeId: string; locked: boolean };
    const node = await ctx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('lockAspectRatio' in node))
      throw new Error('set_aspect_ratio_lock: node not found or not resizable');
    if (p.locked) node.lockAspectRatio();
    else node.unlockAspectRatio();
    return { ok: true, nodeId: node.id };
  };

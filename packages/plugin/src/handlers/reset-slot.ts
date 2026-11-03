import type { SandboxToolHandler } from '../dispatcher.js';

export const createResetSlotHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { nodeId: string };
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node?.type !== 'SLOT') throw new Error(`reset_slot: ${p.nodeId} is not a SLOT`);
    node.resetSlot();
    return { ok: true, nodeId: node.id };
  };

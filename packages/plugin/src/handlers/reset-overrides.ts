import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';

/* eslint-disable no-await-in-loop -- reset parents before reading children; yield between slices */

export const createResetOverridesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { instanceId: string; recursive?: boolean };
    const node = await figmaCtx.getNodeByIdAsync(p.instanceId);
    if (node?.type !== 'INSTANCE')
      throw new Error(`reset_overrides: ${p.instanceId} is not an INSTANCE`);
    const stack: SceneNode[] = [node];
    const resetInstanceIds: string[] = [];
    const slice = new TimeSlice();
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next.type === 'INSTANCE') {
        next.removeOverrides();
        resetInstanceIds.push(next.id);
      }
      if (p.recursive && 'children' in next) {
        for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]!);
      }
      if (slice.due()) await slice.yield();
    }
    return { ok: true, instanceId: node.id, resetInstanceIds };
  };

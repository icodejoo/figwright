import type { SandboxToolHandler } from '../dispatcher.js';
import { resolveComponentOwner } from './component-property.js';

export const createCreateSlotHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { componentId: string };
    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node?.type !== 'COMPONENT')
      throw new Error(`create_slot: ${p.componentId} is not a main COMPONENT`);
    const owner = resolveComponentOwner('create_slot', node);
    const slot = node.createSlot();
    // The installed typings omit slotContentId; Figma's official Slot guide uses this reference.
    const refs = slot.componentPropertyReferences as { slotContentId?: string } | null;
    return {
      ok: true,
      nodeId: slot.id,
      name: slot.name,
      type: slot.type,
      componentId: owner.id,
      propertyId: refs?.slotContentId,
    };
  };

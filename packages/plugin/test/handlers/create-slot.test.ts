import { describe, expect, it, vi } from 'vitest';

import { createCreateSlotHandler } from '../../src/handlers/create-slot.js';

describe('create_slot', () => {
  it('returns the automatically created property on the owning set', async () => {
    const set = { id: 'set', type: 'COMPONENT_SET' };
    const createSlot = vi.fn<
      () => {
        id: string;
        name: string;
        type: string;
        componentPropertyReferences: { slotContentId: string };
      }
    >(() => ({
      id: 'slot',
      name: 'Slot',
      type: 'SLOT',
      componentPropertyReferences: { slotContentId: 'Content#1' },
    }));
    const ctx = {
      getNodeByIdAsync: async () => ({ id: 'variant', type: 'COMPONENT', parent: set, createSlot }),
    } as unknown as typeof figma;
    await expect(createCreateSlotHandler(ctx)({ componentId: 'variant' })).resolves.toEqual({
      ok: true,
      nodeId: 'slot',
      name: 'Slot',
      type: 'SLOT',
      componentId: 'set',
      propertyId: 'Content#1',
    });
    expect(createSlot).toHaveBeenCalledOnce();
  });
  it('rejects a set and preserves native availability errors', async () => {
    await expect(
      createCreateSlotHandler({
        getNodeByIdAsync: async () => ({ type: 'COMPONENT_SET' }),
      } as unknown as typeof figma)({ componentId: 'set' }),
    ).rejects.toThrow(/main COMPONENT/);
    const error = new Error('plan unavailable');
    await expect(
      createCreateSlotHandler({
        getNodeByIdAsync: async () => ({
          type: 'COMPONENT',
          parent: null,
          createSlot: () => {
            throw error;
          },
        }),
      } as unknown as typeof figma)({ componentId: 'c' }),
    ).rejects.toBe(error);
  });
});

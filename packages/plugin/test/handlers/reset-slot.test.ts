import { describe, expect, it, vi } from 'vitest';

import { createResetSlotHandler } from '../../src/handlers/reset-slot.js';

describe('reset_slot', () => {
  it('calls the native reset and returns its failure unchanged', async () => {
    const resetSlot = vi.fn<(...args: unknown[]) => void>();
    const ctx = {
      getNodeByIdAsync: async () => ({ id: 'slot', type: 'SLOT', resetSlot }),
    } as unknown as typeof figma;
    await expect(createResetSlotHandler(ctx)({ nodeId: 'slot' })).resolves.toEqual({
      ok: true,
      nodeId: 'slot',
    });
    expect(resetSlot).toHaveBeenCalledOnce();
    const error = new Error('cannot reset this slot');
    resetSlot.mockImplementation(() => {
      throw error;
    });
    await expect(createResetSlotHandler(ctx)({ nodeId: 'slot' })).rejects.toBe(error);
    await expect(
      createResetSlotHandler({
        getNodeByIdAsync: async () => ({ type: 'FRAME' }),
      } as unknown as typeof figma)({ nodeId: 'frame' }),
    ).rejects.toThrow(/not a SLOT/);
  });
});

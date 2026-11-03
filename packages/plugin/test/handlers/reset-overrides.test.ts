import { describe, expect, it, vi } from 'vitest';

import { createResetOverridesHandler } from '../../src/handlers/reset-overrides.js';

describe('reset_overrides', () => {
  it('resets only the root by default and traverses the post-reset tree when recursive', async () => {
    const removedChild = {
      id: 'old',
      type: 'INSTANCE',
      removeOverrides: vi.fn<(...args: unknown[]) => void>(),
    };
    const nested = {
      id: 'new',
      type: 'INSTANCE',
      removeOverrides: vi.fn<(...args: unknown[]) => void>(),
      children: [],
    };
    const root = {
      id: 'root',
      type: 'INSTANCE',
      children: [removedChild],
      removeOverrides: vi.fn<() => void>(() => {
        root.children = [nested];
      }),
    };
    const ctx = { getNodeByIdAsync: async () => root } as unknown as typeof figma;
    await createResetOverridesHandler(ctx)({ instanceId: 'root' });
    expect(nested.removeOverrides).not.toHaveBeenCalled();
    await expect(
      createResetOverridesHandler(ctx)({ instanceId: 'root', recursive: true }),
    ).resolves.toEqual({ ok: true, instanceId: 'root', resetInstanceIds: ['root', 'new'] });
    expect(removedChild.removeOverrides).not.toHaveBeenCalled();
    expect(nested.removeOverrides).toHaveBeenCalledOnce();
  });
  it('rejects a non-instance', async () => {
    await expect(
      createResetOverridesHandler({
        getNodeByIdAsync: async () => null,
      } as unknown as typeof figma)({ instanceId: 'missing' }),
    ).rejects.toThrow(/not an INSTANCE/);
  });
});

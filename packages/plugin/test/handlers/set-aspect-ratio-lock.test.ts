import { expect, it, vi } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetAspectRatioLockHandler } from '../../src/handlers/set-aspect-ratio-lock.js';
import { batch3Fake } from './batch3-fake.js';
it('uses lock/unlock methods, preserves native errors and refuses unreliable batch rollback', async () => {
  const node = {
    id: 'x',
    lockAspectRatio: vi.fn<() => void>(),
    unlockAspectRatio: vi.fn<() => void>(),
  };
  const { ctx } = batch3Fake({ x: node });
  const set = createSetAspectRatioLockHandler(ctx);
  await set({ nodeId: 'x', locked: true });
  await set({ nodeId: 'x', locked: false });
  expect(node.lockAspectRatio).toHaveBeenCalledOnce();
  expect(node.unlockAspectRatio).toHaveBeenCalledOnce();
  node.lockAspectRatio.mockImplementation(() => {
    throw new Error('text auto resize');
  });
  await expect(set({ nodeId: 'x', locked: true })).rejects.toThrow('text auto resize');
  await expect(set({ nodeId: 'missing', locked: true })).rejects.toThrow('not resizable');
  await expect(
    createBatchHandler(ctx, { set_aspect_ratio_lock: set })({
      ops: [{ tool: 'set_aspect_ratio_lock', params: { nodeId: 'x', locked: true } }],
    }),
  ).rejects.toThrow('not batchable');
});

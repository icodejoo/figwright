import { expect, it, vi } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSaveVersionHandler } from '../../src/handlers/save-version.js';
it('waits for pending edits, returns version or null and propagates Figma errors', async () => {
  vi.useFakeTimers();
  try {
    const save = vi
      .fn<(title: string, description?: string) => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce({ id: 'v1' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('plan restriction'));
    const ctx = { saveVersionHistoryAsync: save } as unknown as typeof figma;
    const handler = createSaveVersionHandler(ctx);
    const first = handler({ title: 'checkpoint', description: 'before changes' });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ version: { id: 'v1' } });
    expect(save).toHaveBeenCalledWith('checkpoint', 'before changes');
    const second = handler({ title: 'null' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toEqual({ version: null });
    const third = Promise.resolve(handler({ title: 'fail' })).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await third).toEqual(new Error('plan restriction'));
    await expect(
      createBatchHandler(ctx, { save_version: handler })({
        ops: [{ tool: 'save_version', params: { title: 'bad' } }],
      }),
    ).rejects.toThrow('not batchable');
  } finally {
    vi.useRealTimers();
  }
});

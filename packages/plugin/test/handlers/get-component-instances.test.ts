import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimeSlice } from '../../src/cooperative.js';
import { createGetComponentInstancesHandler } from '../../src/handlers/get-component-instances.js';

afterEach(() => vi.restoreAllMocks());

describe('get_component_instances', () => {
  it('queries each variant directly, de-duplicates, slices and reports truncation across variants', async () => {
    const page = { id: 'page', name: 'Components', type: 'PAGE', parent: null };
    const parent = { id: 'frame', name: 'Container', type: 'FRAME', parent: page };
    const a = { id: 'a', name: 'Instance', parent };
    const b = { id: 'b', name: 'Instance', parent: page };
    const first = vi.fn<() => Promise<(typeof a)[]>>(async () => [a]);
    const second = vi.fn<() => Promise<(typeof a | typeof b)[]>>(async () => [a, b]);
    const load = vi.fn<() => Promise<void>>(async () => {});
    const ctx = {
      getNodeByIdAsync: async () => ({
        id: 'set',
        type: 'COMPONENT_SET',
        children: [
          { id: 'v1', type: 'COMPONENT', getInstancesAsync: first },
          { id: 'v2', type: 'COMPONENT', getInstancesAsync: second },
        ],
      }),
      loadAllPagesAsync: load,
    } as unknown as typeof figma;
    vi.spyOn(TimeSlice.prototype, 'due').mockReturnValue(true);
    const yields = vi.spyOn(TimeSlice.prototype, 'yield').mockResolvedValue();
    const result = await createGetComponentInstancesHandler(ctx)({ componentId: 'set', limit: 1 });
    expect(result).toEqual({
      componentId: 'set',
      truncated: true,
      instances: [
        {
          id: 'a',
          name: 'Instance',
          componentId: 'v1',
          parentId: 'frame',
          page: { id: 'page', name: 'Components' },
          parentPath: [
            { id: 'page', name: 'Components', type: 'PAGE' },
            { id: 'frame', name: 'Container', type: 'FRAME' },
          ],
        },
      ],
    });
    expect(load).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(yields).toHaveBeenCalled();
  });

  it('does not mark an exact limit as truncated, and rejects invalid targets/limits', async () => {
    const ctx = {
      getNodeByIdAsync: async () => ({
        id: 'c',
        type: 'COMPONENT',
        getInstancesAsync: async () => [{ id: 'i', name: 'I', parent: null }],
      }),
      loadAllPagesAsync: async () => {},
    } as unknown as typeof figma;
    await expect(
      createGetComponentInstancesHandler(ctx)({ componentId: 'c', limit: 1 }),
    ).resolves.toMatchObject({ truncated: false });
    await expect(
      createGetComponentInstancesHandler(ctx)({ componentId: 'c', limit: 0 }),
    ).rejects.toThrow(/limit/);
    await expect(
      createGetComponentInstancesHandler({
        getNodeByIdAsync: async () => null,
      } as unknown as typeof figma)({ componentId: 'missing' }),
    ).rejects.toThrow(/not a component/);
  });
});

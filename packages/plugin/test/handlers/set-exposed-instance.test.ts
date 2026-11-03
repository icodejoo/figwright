import { describe, expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetExposedInstanceHandler } from '../../src/handlers/set-exposed-instance.js';

const setup = () => {
  const component = { id: 'C', type: 'COMPONENT', parent: null };
  const node = {
    id: 'N',
    type: 'INSTANCE',
    parent: component,
    isExposedInstance: false,
    overrides: [],
    findAllWithCriteria: () => [],
  };
  const ctx = {
    root: { children: [] },
    getNodeByIdAsync: async (id: string) => (id === 'N' ? node : null),
  } as unknown as typeof figma;
  return { node, ctx, handler: createSetExposedInstanceHandler(ctx) };
};

describe('set_exposed_instance', () => {
  it('exposes and unexposes a primary instance', async () => {
    const { node, handler } = setup();
    expect(await handler({ nodeId: 'N', exposed: true })).toEqual({ ok: true, nodeId: 'N' });
    expect(node.isExposedInstance).toBe(true);
    await handler({ nodeId: 'N', exposed: false });
    expect(node.isExposedInstance).toBe(false);
  });

  it.each(['COMPONENT', 'COMPONENT_SET'])(
    'allows frames/groups between the instance and %s',
    async type => {
      const { node, handler } = setup();
      node.parent = {
        id: 'F',
        type: 'FRAME',
        parent: { id: 'G', type: 'GROUP', parent: { id: 'C', type, parent: null } },
      } as unknown as typeof node.parent;
      await handler({ nodeId: 'N', exposed: true });
      expect(node.isExposedInstance).toBe(true);
    },
  );

  it.each([
    [{}, /nodeId must be a string/],
    [{ nodeId: 'N', exposed: 'true' }, /exposed must be a boolean/],
    [{ nodeId: 'missing', exposed: true }, /not found/],
  ])('rejects invalid input %j', async (params, error) => {
    await expect(setup().handler(params)).rejects.toThrow(error);
  });

  it('rejects non-instances, standalone instances and inherited instances without changing them', async () => {
    const { node, handler } = setup();
    node.type = 'FRAME';
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow(/not an INSTANCE/);
    node.type = 'INSTANCE';
    node.parent.type = 'PAGE';
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow(/must be contained/);
    node.parent.type = 'INSTANCE';
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow(/inherits exposure/);
    expect(node.isExposedInstance).toBe(false);
  });

  it('preserves a Figma setter error verbatim', async () => {
    const { node, handler } = setup();
    Object.defineProperty(node, 'isExposedInstance', {
      set: () => {
        throw new Error('Figma refused write');
      },
    });
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow('Figma refused write');
  });

  it('rejects a read-only remote component before writing', async () => {
    const { node, handler } = setup();
    Object.assign(node.parent, { remote: true });
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow(/read-only remote/);
    expect(node.isExposedInstance).toBe(false);
  });

  it('does not report success when the API ignores a write', async () => {
    const { node, handler } = setup();
    Object.defineProperty(node, 'isExposedInstance', { get: () => false, set: () => {} });
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow(/did not retain/);
  });

  it('restores a setter that mutates before throwing, so a failing batch op leaves no partial write', async () => {
    const { node, handler } = setup();
    let value = false;
    Object.defineProperty(node, 'isExposedInstance', {
      get: () => value,
      set: (next: boolean) => {
        value = next;
        if (next) throw new Error('failed after mutation');
      },
    });
    await expect(handler({ nodeId: 'N', exposed: true })).rejects.toThrow('failed after mutation');
    expect(value).toBe(false);
  });

  it('avoids writing an already matching value', async () => {
    const { node, handler } = setup();
    Object.defineProperty(node, 'isExposedInstance', {
      get: () => false,
      set: () => {
        throw new Error('unexpected write');
      },
    });
    expect(await handler({ nodeId: 'N', exposed: false })).toEqual({ ok: true, nodeId: 'N' });
  });

  it.each([false, true])(
    'rolls back to the previous value %s after a later failure',
    async previous => {
      const { node, ctx, handler } = setup();
      node.isExposedInstance = previous;
      const batch = createBatchHandler(ctx, {
        set_exposed_instance: handler,
        set_visible: () => {
          throw new Error('later failure');
        },
      });
      Object.assign(node, { visible: true });
      await expect(
        batch({
          ops: [
            { tool: 'set_exposed_instance', params: { nodeId: 'N', exposed: !previous } },
            { tool: 'set_visible', params: { nodeId: 'N', visible: false } },
          ],
        }),
      ).rejects.toThrow(/rolled back 1 applied op/);
      expect(node.isExposedInstance).toBe(previous);
    },
  );
});

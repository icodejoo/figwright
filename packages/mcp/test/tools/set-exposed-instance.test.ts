import { describe, expect, it } from 'vitest';

import { setExposedInstanceTool } from '../../src/tools/set-exposed-instance.js';

describe('set_exposed_instance tool', () => {
  it.each([true, false])('accepts a typed exposure value %s', exposed => {
    expect(setExposedInstanceTool.inputSchema.parse({ nodeId: '1:2', exposed })).toEqual({
      nodeId: '1:2',
      exposed,
    });
    expect(setExposedInstanceTool.kind).toBe('write');
  });

  it.each([{ nodeId: '1:2' }, { exposed: true }, { nodeId: '1:2', exposed: 'true' }])(
    'rejects malformed arguments %j',
    args => {
      expect(setExposedInstanceTool.inputSchema.safeParse(args).success).toBe(false);
    },
  );
});

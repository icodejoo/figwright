import type { VariableResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdateVariableHandler } from '../../src/handlers/update-variable.js';

/**
 * A variable that refuses what Figma refuses: a scope that does not fit its type, and hiding a
 * variable that comes from a library. `failOn` names the field whose write throws.
 */
const makeVariable = (failOn?: 'scopes' | 'hiddenFromPublishing') => {
  const state = {
    description: '',
    scopes: ['ALL_SCOPES'] as string[],
    hiddenFromPublishing: false,
  };
  const variable = {
    id: 'V:1',
    name: 'radius/md',
    get description() {
      return state.description;
    },
    set description(v: string) {
      state.description = v;
    },
    get scopes() {
      return state.scopes;
    },
    set scopes(v: string[]) {
      if (failOn === 'scopes' && v.includes('CORNER_RADIUS')) {
        throw new Error('Invalid scope for this variable type');
      }
      state.scopes = v;
    },
    get hiddenFromPublishing() {
      return state.hiddenFromPublishing;
    },
    set hiddenFromPublishing(v: boolean) {
      if (failOn === 'hiddenFromPublishing' && v) throw new Error('variable is remote');
      state.hiddenFromPublishing = v;
    },
  };
  const figmaCtx = {
    variables: { getVariableByIdAsync: async (id: string) => (id === 'V:1' ? variable : null) },
  } as unknown as typeof figma;
  return { state, handler: createUpdateVariableHandler(figmaCtx) };
};

describe('update_variable handler', () => {
  it('sets description, scopes and hiddenFromPublishing and echoes the result', async () => {
    const { state, handler } = makeVariable();
    const result = (await handler({
      variableId: 'V:1',
      description: 'Corner radius, medium containers',
      scopes: ['CORNER_RADIUS'],
      hiddenFromPublishing: true,
    })) as VariableResult;

    expect(state).toEqual({
      description: 'Corner radius, medium containers',
      scopes: ['CORNER_RADIUS'],
      hiddenFromPublishing: true,
    });
    expect(result).toEqual({
      ok: true,
      variableId: 'V:1',
      name: 'radius/md',
      description: 'Corner radius, medium containers',
      scopes: ['CORNER_RADIUS'],
      hiddenFromPublishing: true,
    });
  });

  it('leaves omitted fields alone, and "" clears a description', async () => {
    const { state, handler } = makeVariable();
    await handler({ variableId: 'V:1', description: 'note' });
    await handler({ variableId: 'V:1', hiddenFromPublishing: true });
    expect(state).toEqual({
      description: 'note',
      scopes: ['ALL_SCOPES'],
      hiddenFromPublishing: true,
    });
    await handler({ variableId: 'V:1', description: '' });
    expect(state.description).toBe('');
  });

  it('puts earlier fields back when a later one is refused, and says why', async () => {
    const { state, handler } = makeVariable('scopes');
    await expect(
      handler({ variableId: 'V:1', description: 'x', scopes: ['CORNER_RADIUS'] }),
    ).rejects.toThrow(/Invalid scope for this variable type.*nothing was changed/s);
    expect(state).toEqual({ description: '', scopes: ['ALL_SCOPES'], hiddenFromPublishing: false });

    const remote = makeVariable('hiddenFromPublishing');
    await expect(
      remote.handler({ variableId: 'V:1', description: 'y', hiddenFromPublishing: true }),
    ).rejects.toThrow(/only local variables can be hidden/);
    expect(remote.state.description).toBe('');
  });

  it('rejects bad input and an unknown variable', async () => {
    const { handler } = makeVariable();
    await expect(handler({})).rejects.toThrow(/variableId/);
    await expect(handler({ variableId: 'V:1', description: 3 })).rejects.toThrow(/description/);
    await expect(handler({ variableId: 'V:1', hiddenFromPublishing: 'yes' })).rejects.toThrow(
      /boolean/,
    );
    await expect(handler({ variableId: 'V:1', scopes: [] })).rejects.toThrow(/non-empty/);
    await expect(handler({ variableId: 'V:1', scopes: 'ALL_SCOPES' })).rejects.toThrow(/non-empty/);
    await expect(handler({ variableId: 'V:9' })).rejects.toThrow(/not found/);
  });
});

import { getToolBudget } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';
import { fitVariableBindings } from '../../src/tools/result-budget.js';

describe('variable binding tool contracts', () => {
  it('registers 162 tools, with heavy budgets and safe defaults', () => {
    expect(ALL_TOOL_SPECS).toHaveLength(162);
    for (const name of ['scan_variable_bindings', 'rebind_variables'])
      expect(getToolBudget(name)).toBe(120_000);
    const spec = ALL_TOOL_SPECS.find(tool => tool.name === 'rebind_variables')!;
    expect(spec.kind).toBe('write');
    expect(spec.inputSchema.parse({ mapping: [{ from: 'a', to: 'b' }] })).toEqual({
      mapping: [{ from: 'a', to: 'b' }],
      dryRun: true,
      includeInstanceSublayers: false,
      timeBudgetMs: 90000,
    });
    for (const mapping of [
      [],
      [{ from: 'a', to: 'a' }],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    ])
      expect(spec.inputSchema.safeParse({ mapping }).success).toBe(false);
  });
  it('fits exact escaped UTF-8 bytes, retaining the highest counts and complete flag', () => {
    const result = {
      complete: false,
      visited: 100,
      bindings: Array.from({ length: 40 }, (_, count) => ({
        count,
        variableId: `V${count}`,
        name: '变量"\\'.repeat(100),
      })),
    };
    const bytes = (value: unknown) =>
      Buffer.byteLength(JSON.stringify(JSON.stringify(value)), 'utf8') - 2;
    expect(fitVariableBindings(result, bytes(result))).toBe(result);
    const fitted = fitVariableBindings(result, 5000);
    expect(bytes(fitted)).toBeLessThanOrEqual(5000);
    expect(fitted).toMatchObject({ truncated: true, complete: false, visited: 100 });
    expect(fitted.bindings.length).toBeGreaterThan(0);
    expect(fitted.bindings).toEqual(result.bindings.toReversed().slice(0, fitted.bindings.length));
  });
});

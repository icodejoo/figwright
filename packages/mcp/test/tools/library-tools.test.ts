import { getToolBudget, MIN_PLUGIN_VERSION } from '@figwright/shared';
import { describe, it, expect } from 'vitest';

import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';
import { fitLibraryResult } from '../../src/tools/result-budget.js';
const spec = (name: string) => ALL_TOOL_SPECS.find(t => t.name === name)!;
describe('library tools', () => {
  it('advertises 162 tools and keeps the plugin floor and budgets', () => {
    expect(ALL_TOOL_SPECS).toHaveLength(162);
    expect(MIN_PLUGIN_VERSION).toBe('0.8.0');
    expect(getToolBudget('get_publish_status')).toBe(120000);
    expect(getToolBudget('bind_variables_by_value')).toBe(120000);
    expect(getToolBudget('list_team_library')).toBe(30000);
  });
  it('pins defaults, ranges and write/read semantics', () => {
    expect(spec('get_publish_status').inputSchema.parse({})).toEqual({
      kind: 'VARIABLE_COLLECTION',
      limit: 500,
    });
    expect(spec('list_team_library').inputSchema.parse({})).toEqual({ limit: 200 });
    expect(spec('bind_variables_by_value').inputSchema.parse({ variableIds: ['v'] })).toEqual({
      variableIds: ['v'],
      tolerance: 0,
      dryRun: true,
      includeInstanceSublayers: false,
      timeBudgetMs: 90000,
      onAmbiguous: 'skip',
    });
    for (const params of [
      { variableIds: [] },
      { variableIds: ['v'], tolerance: 0.011 },
      { variableIds: ['v'], timeBudgetMs: 100001 },
    ])
      expect(spec('bind_variables_by_value').inputSchema.safeParse(params).success).toBe(false);
    expect(spec('get_publish_status').inputSchema.safeParse({ limit: 5001 }).success).toBe(false);
    expect(spec('list_team_library').inputSchema.safeParse({ limit: 2001 }).success).toBe(false);
    expect(spec('get_publish_status').kind).toBe('read');
    expect(spec('list_team_library').kind).toBe('read');
    expect(spec('bind_variables_by_value').kind).toBe('write');
  });
  it('trims each result list to exact escaped wire bytes without losing execution counts', () => {
    for (const field of ['items', 'collections', 'variables', 'perVariable']) {
      const result = {
        complete: false,
        changed: { fills: 100 },
        counts: { CHANGED: 100 },
        [field]: Array.from({ length: 100 }, (_, i) => ({ id: i, name: '变量"\\'.repeat(100) })),
      };
      const fitted = fitLibraryResult(result, 4000);
      const bytes = Buffer.byteLength(JSON.stringify(JSON.stringify(fitted)), 'utf8') - 2;
      expect(bytes).toBeLessThanOrEqual(4000);
      expect(fitted).toMatchObject({
        truncated: true,
        complete: false,
        changed: { fills: 100 },
        counts: { CHANGED: 100 },
      });
      expect((fitted[field] as unknown[]).length).toBeGreaterThan(0);
    }
  });
});

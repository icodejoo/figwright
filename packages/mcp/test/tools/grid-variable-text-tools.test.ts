import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

// Argument schemas of the grid, variable-metadata and text-detail writes. Parsed through the specs
// the registry actually advertises (closed objects), so an argument that is misspelt — or that a
// tool never declared — is refused here exactly as it is on the wire.

const parse = (tool: string, args: Record<string, unknown>) => {
  const spec = ALL_TOOL_SPECS.find(s => s.name === tool);
  if (spec === undefined) throw new Error(`no such tool: ${tool}`);
  return spec.inputSchema.safeParse(args);
};

describe('set_auto_layout grid track sizes', () => {
  it('accepts FLEX / FIXED / HUG tracks in the shape the reads report', () => {
    expect(
      parse('set_auto_layout', {
        nodeId: '1:1',
        layoutMode: 'GRID',
        gridRowSizes: [{ type: 'FIXED', value: 80 }, { type: 'HUG' }],
        gridColumnSizes: [{ type: 'FLEX', value: 2 }, { type: 'FLEX' }],
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown track type and a non-positive size', () => {
    const base = { nodeId: '1:1', layoutMode: 'GRID' };
    expect(parse('set_auto_layout', { ...base, gridRowSizes: [{ type: 'AUTO' }] }).success).toBe(
      false,
    );
    expect(
      parse('set_auto_layout', { ...base, gridRowSizes: [{ type: 'FIXED', value: 0 }] }).success,
    ).toBe(false);
  });
});

describe('set_grid_child', () => {
  it('takes a cell, spans and per-cell alignment', () => {
    expect(
      parse('set_grid_child', {
        nodeId: '1:1',
        rowAnchorIndex: 0,
        columnAnchorIndex: 2,
        rowSpan: 2,
        columnSpan: 1,
        horizontalAlign: 'CENTER',
        verticalAlign: 'AUTO',
      }).success,
    ).toBe(true);
  });

  it('refuses negative or fractional indices, a zero span and an unknown alignment', () => {
    expect(parse('set_grid_child', { nodeId: '1:1', rowAnchorIndex: -1 }).success).toBe(false);
    expect(parse('set_grid_child', { nodeId: '1:1', columnAnchorIndex: 0.5 }).success).toBe(false);
    expect(parse('set_grid_child', { nodeId: '1:1', rowSpan: 0 }).success).toBe(false);
    expect(parse('set_grid_child', { nodeId: '1:1', horizontalAlign: 'LEFT' }).success).toBe(false);
    expect(parse('set_grid_child', { nodeId: '1:1', row: 1 }).success).toBe(false);
  });
});

describe('reorder_grid_tracks', () => {
  it('needs an axis, at least one index and an insertion point', () => {
    const ok = { nodeId: 'G', axis: 'ROWS', fromIndices: [0, 1], insertionIndex: 3 };
    expect(parse('reorder_grid_tracks', ok).success).toBe(true);
    expect(parse('reorder_grid_tracks', { ...ok, axis: 'COLUMNS' }).success).toBe(true);
    expect(parse('reorder_grid_tracks', { ...ok, axis: 'DIAGONAL' }).success).toBe(false);
    expect(parse('reorder_grid_tracks', { ...ok, fromIndices: [] }).success).toBe(false);
    expect(parse('reorder_grid_tracks', { ...ok, insertionIndex: -1 }).success).toBe(false);
  });
});

describe('reparent_nodes cell arguments', () => {
  it('accepts a cell and refuses a negative one', () => {
    const base = { nodeIds: ['1:1'], newParentId: '2:0' };
    expect(
      parse('reparent_nodes', { ...base, rowAnchorIndex: 0, columnAnchorIndex: 1 }).success,
    ).toBe(true);
    expect(parse('reparent_nodes', { ...base, rowAnchorIndex: -1 }).success).toBe(false);
  });
});

describe('update_variable', () => {
  it('takes description, scopes and hiddenFromPublishing', () => {
    expect(
      parse('update_variable', {
        variableId: 'V:1',
        description: 'Radius for medium containers',
        scopes: ['CORNER_RADIUS'],
        hiddenFromPublishing: true,
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown or empty scope list', () => {
    expect(parse('update_variable', { variableId: 'V:1', scopes: ['FILLS'] }).success).toBe(false);
    expect(parse('update_variable', { variableId: 'V:1', scopes: [] }).success).toBe(false);
  });
});

describe('update_variable_collection hiddenFromPublishing', () => {
  it('is a boolean', () => {
    const base = { collectionId: 'VC:1' };
    expect(
      parse('update_variable_collection', { ...base, hiddenFromPublishing: true }).success,
    ).toBe(true);
    expect(
      parse('update_variable_collection', { ...base, hiddenFromPublishing: 'yes' }).success,
    ).toBe(false);
  });
});

describe('text style typography', () => {
  const fields = {
    textCase: 'UPPER',
    textDecoration: 'UNDERLINE',
    leadingTrim: 'CAP_HEIGHT',
    paragraphSpacing: 8,
    paragraphIndent: 4,
    listSpacing: 6,
    hangingPunctuation: true,
    hangingList: false,
  };

  it('create_text_style and update_text_style take the same fields', () => {
    expect(parse('create_text_style', { name: 'Label/Caps', ...fields }).success).toBe(true);
    expect(parse('update_text_style', { styleId: 'S:1', ...fields }).success).toBe(true);
  });

  it('refuses an unknown case and a negative spacing', () => {
    expect(parse('create_text_style', { name: 'X', textCase: 'SHOUT' }).success).toBe(false);
    expect(parse('update_text_style', { styleId: 'S:1', listSpacing: -1 }).success).toBe(false);
  });
});

describe('set_text_properties and set_text_range detail fields', () => {
  const decoration = {
    textDecorationStyle: 'WAVY',
    textDecorationOffset: { unit: 'PIXELS', value: 2 },
    textDecorationThickness: { unit: 'AUTO' },
    textDecorationColor: { r: 1, g: 0, b: 0 },
    textDecorationSkipInk: false,
  };

  it('set_text_properties takes trim, list, hanging and the underline details', () => {
    expect(
      parse('set_text_properties', {
        nodeId: '1:1',
        leadingTrim: 'CAP_HEIGHT',
        listSpacing: 4,
        hangingPunctuation: true,
        hangingList: true,
        ...decoration,
      }).success,
    ).toBe(true);
    expect(
      parse('set_text_properties', { nodeId: '1:1', textDecorationColor: 'AUTO' }).success,
    ).toBe(true);
  });

  it('set_text_properties refuses malformed underline details', () => {
    const bad = (extra: Record<string, unknown>) =>
      parse('set_text_properties', { nodeId: '1:1', ...extra }).success;
    expect(bad({ textDecorationStyle: 'DOUBLE' })).toBe(false);
    expect(bad({ textDecorationOffset: { unit: 'PIXELS' } })).toBe(false);
    expect(bad({ textDecorationColor: { r: 2, g: 0, b: 0 } })).toBe(false);
    expect(bad({ textDecorationColor: '#FF0000' })).toBe(false);
    expect(bad({ leadingTrim: 'ALL' })).toBe(false);
  });

  it('set_text_range takes the underline details and paragraph fields per range', () => {
    expect(
      parse('set_text_range', {
        nodeId: '1:1',
        ranges: [
          { start: 0, end: 4, textDecoration: 'UNDERLINE', ...decoration },
          { start: 4, end: 9, paragraphSpacing: 8, paragraphIndent: 2, listSpacing: 3 },
        ],
      }).success,
    ).toBe(true);
  });
});

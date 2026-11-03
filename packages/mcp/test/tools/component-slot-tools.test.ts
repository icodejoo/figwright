import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

const spec = (name: string) => ALL_TOOL_SPECS.find(tool => tool.name === name)!;

describe('component and style API tools', () => {
  it('advertises every new tool, and rejects unrecognized arguments', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['get_component_instances', { componentId: 'c', limit: 1 }],
      ['get_style_consumers', { styleId: 's' }],
      ['update_component', { componentId: 'c', documentationLinks: [] }],
      ['create_slot', { componentId: 'c' }],
      ['reset_slot', { nodeId: 's' }],
      ['reset_overrides', { instanceId: 'i', recursive: true }],
      ['reorder_styles', { kind: 'CUSTOM_ANIMATION', styleId: 's', afterStyleId: null }],
      ['reorder_style_folders', { kind: 'TEXT', folder: 'A/B', afterFolder: null }],
    ];
    for (const [name, args] of cases) {
      expect({ name, success: spec(name).inputSchema.safeParse(args).success }).toEqual({
        name,
        success: true,
      });
      expect({
        name,
        success: spec(name).inputSchema.safeParse({ ...args, invented: true }).success,
      }).toEqual({ name, success: false });
    }
  });
  it('accepts nullable slot limits and advertises editor/plan limits', () => {
    const args = {
      componentId: 'c',
      name: 'Content',
      type: 'SLOT',
      defaultValue: '',
      description: 'Content area',
      slotSettings: {
        minChildren: null,
        maxChildren: 3,
        stretchChildOnInsert: true,
        displayEmptyByDefault: false,
        allowPreferredValuesOnly: false,
      },
    };
    expect(spec('add_component_property').inputSchema.parse(args)).toEqual(args);
    expect(
      spec('edit_component_property').inputSchema.safeParse({
        componentId: 'c',
        propertyId: 'Content#1',
        slotSettings: { maxChildren: -1 },
      }).success,
    ).toBe(false);
    for (const name of [
      'create_slot',
      'reset_slot',
      'add_component_property',
      'edit_component_property',
    ])
      expect(spec(name).description).toContain('可用性取决于套餐与编辑器');
    expect(
      spec('bind_component_property').inputSchema.safeParse({
        nodeId: 'frame',
        field: 'slotContentId',
        propertyId: 'Content#1',
      }).success,
    ).toBe(true);
  });
  it('limits reverse lookups and documentation link counts', () => {
    expect(
      spec('get_component_instances').inputSchema.safeParse({ componentId: 'c', limit: 10001 })
        .success,
    ).toBe(false);
    expect(
      spec('get_style_consumers').inputSchema.safeParse({ styleId: 's', limit: 1.5 }).success,
    ).toBe(false);
    expect(
      spec('update_component').inputSchema.safeParse({
        componentId: 'c',
        documentationLinks: [{ uri: 'a' }, { uri: 'b' }],
      }).success,
    ).toBe(false);
  });
});

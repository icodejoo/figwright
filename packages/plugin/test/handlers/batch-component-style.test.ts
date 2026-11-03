import { describe, expect, it, vi } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createCreateSlotHandler } from '../../src/handlers/create-slot.js';
import { createEditComponentPropertyHandler } from '../../src/handlers/edit-component-property.js';
import { createReorderStyleFoldersHandler } from '../../src/handlers/reorder-style-folders.js';
import { createReorderStylesHandler } from '../../src/handlers/reorder-styles.js';
import { createUpdateComponentHandler } from '../../src/handlers/update-component.js';

const fail = async () => {
  throw new Error('deliberate failure');
};
const op = (tool: string, params: Record<string, unknown>) => ({ tool, params });

describe('batch component and style inverses', () => {
  it('restores rich markdown without flattening it to plain text', async () => {
    let markdown = '**Original**';
    const node = {
      id: 'c',
      type: 'COMPONENT_SET',
      remote: false,
      documentationLinks: [{ uri: 'original' }],
      get descriptionMarkdown() {
        return markdown;
      },
      set descriptionMarkdown(value: string) {
        markdown = value;
      },
      get description() {
        return markdown.replaceAll('*', '');
      },
      set description(value: string) {
        markdown = value;
      },
    };
    const ctx = {
      root: { children: [] },
      getNodeByIdAsync: async () => node,
    } as unknown as typeof figma;
    const batch = createBatchHandler(ctx, {
      update_component: createUpdateComponentHandler(ctx),
      add_component_property: fail,
    });
    await expect(
      batch({
        ops: [
          op('update_component', {
            componentId: 'c',
            description: 'changed',
            documentationLinks: [],
          }),
          op('add_component_property', {}),
        ],
      }),
    ).rejects.toThrow(/rolled back 1 applied/);
    expect(markdown).toBe('**Original**');
    expect(node.documentationLinks).toEqual([{ uri: 'original' }]);
  });

  it('restores SLOT descriptions/settings and refuses settings whose prior defaults are unknown', async () => {
    const def = {
      type: 'SLOT',
      defaultValue: '',
      description: 'Original',
      slotSettings: { maxChildren: 5, minChildren: null },
    };
    const node = {
      id: 'c',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Content#1': def },
      editComponentProperty: (_id: string, value: object) => {
        Object.assign(def, value);
        return 'Content#1';
      },
    };
    const ctx = {
      root: { children: [] },
      getNodeByIdAsync: async () => node,
    } as unknown as typeof figma;
    const batch = createBatchHandler(ctx, {
      edit_component_property: createEditComponentPropertyHandler(ctx),
      add_component_property: fail,
    });
    await expect(
      batch({
        ops: [
          op('edit_component_property', {
            componentId: 'c',
            propertyId: 'Content#1',
            description: '',
            slotSettings: { maxChildren: 2 },
          }),
          op('add_component_property', {}),
        ],
      }),
    ).rejects.toThrow(/rolled back 1 applied/);
    expect(def).toMatchObject({
      description: 'Original',
      slotSettings: { maxChildren: 5, minChildren: null },
    });
    await expect(
      batch({
        ops: [
          op('edit_component_property', {
            componentId: 'c',
            propertyId: 'Content#1',
            slotSettings: { stretchChildOnInsert: true },
          }),
        ],
      }),
    ).rejects.toThrow(/absent prior keys/);
  });

  it('removes both a created slot and its implicit property on rollback', async () => {
    const definitions: Record<string, unknown> = {};
    const slot = {
      id: 'slot',
      type: 'SLOT',
      name: 'Slot',
      parent: null,
      componentPropertyReferences: { slotContentId: 'Content#1' },
      remove: vi.fn<(...args: unknown[]) => void>(),
    };
    const component = {
      id: 'c',
      type: 'COMPONENT',
      parent: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [],
      componentPropertyDefinitions: definitions,
      createSlot: () => {
        definitions['Content#1'] = { type: 'SLOT', defaultValue: '' };
        return slot;
      },
      deleteComponentProperty: (id: string) => {
        delete definitions[id];
      },
    };
    const ctx = {
      root: { children: [] },
      getNodeByIdAsync: async (id: string) => (id === 'c' ? component : slot),
    } as unknown as typeof figma;
    const batch = createBatchHandler(ctx, {
      create_slot: createCreateSlotHandler(ctx),
      add_component_property: fail,
    });
    await expect(
      batch({ ops: [op('create_slot', { componentId: 'c' }), op('add_component_property', {})] }),
    ).rejects.toThrow(/rolled back 1 applied/);
    expect(slot.remove).toHaveBeenCalledOnce();
    expect(definitions).toEqual({});
  });

  it('restores all sibling style and folder order after multiple moves', async () => {
    const styles = ['a', 'b', 'c'].map(id => ({
      id,
      type: 'TEXT',
      name: `Root/${id.toUpperCase()}`,
      remote: false,
    }));
    const folders = ['Root/A', 'Root/B', 'Root/C'];
    let styleOrder = [...styles];
    let folderOrder = [...folders];
    const ctx = {
      root: { children: [] },
      getLocalTextStylesAsync: async () => styleOrder,
      getStyleByIdAsync: async (id: string) => styles.find(style => style.id === id) ?? null,
      moveLocalTextStyleAfter: (
        target: (typeof styles)[number],
        reference: (typeof styles)[number] | null,
      ) => {
        styleOrder = styleOrder.filter(style => style.id !== target.id);
        styleOrder.splice(reference === null ? 0 : styleOrder.indexOf(reference) + 1, 0, target);
      },
      moveLocalTextFolderAfter: (target: string, reference: string | null) => {
        folderOrder = folderOrder.filter(folder => folder !== target);
        folderOrder.splice(reference === null ? 0 : folderOrder.indexOf(reference) + 1, 0, target);
      },
    } as unknown as typeof figma;
    const batch = createBatchHandler(ctx, {
      reorder_styles: createReorderStylesHandler(ctx),
      reorder_style_folders: createReorderStyleFoldersHandler(ctx),
      add_component_property: fail,
    });
    await expect(
      batch({
        ops: [
          op('reorder_styles', { kind: 'TEXT', styleId: 'c' }),
          op('reorder_styles', { kind: 'TEXT', styleId: 'b' }),
          op('add_component_property', {}),
        ],
      }),
    ).rejects.toThrow(/rolled back 2 applied/);
    expect(styleOrder.map(style => style.id)).toEqual(['a', 'b', 'c']);
    // Folder paths come from style names; make each leaf style live inside one folder.
    for (const style of styles) style.name += '/Leaf';
    await expect(
      batch({
        ops: [
          op('reorder_style_folders', { kind: 'TEXT', folder: 'Root/C' }),
          op('add_component_property', {}),
        ],
      }),
    ).rejects.toThrow(/rolled back 1 applied/);
    expect(folderOrder).toEqual(folders);
  });

  it('rejects destructive resets and frame-to-Slot binding before any mutation', async () => {
    const applied = vi.fn<(...args: unknown[]) => void>();
    const ctx = {
      root: { children: [] },
      getNodeByIdAsync: async () => null,
    } as unknown as typeof figma;
    const batch = createBatchHandler(ctx, {
      reset_slot: applied,
      reset_overrides: applied,
      bind_component_property: applied,
    });
    await expect(batch({ ops: [op('reset_slot', { nodeId: 's' })] })).rejects.toThrow(
      /not batchable/,
    );
    await expect(batch({ ops: [op('reset_overrides', { instanceId: 'i' })] })).rejects.toThrow(
      /not batchable/,
    );
    await expect(
      batch({
        ops: [
          op('bind_component_property', { nodeId: 'f', field: 'slotContentId', propertyId: 'P#1' }),
        ],
      }),
    ).rejects.toThrow(/no verified inverse/);
    expect(applied).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';

import { componentDocumentation } from '../../src/handlers/component-documentation.js';
import { createUpdateComponentHandler } from '../../src/handlers/update-component.js';

describe('update_component', () => {
  it('updates an exact variant and clears links without editing its parent set', async () => {
    const set = { type: 'COMPONENT_SET', description: 'set docs' };
    const node = {
      id: 'c',
      type: 'COMPONENT',
      parent: set,
      remote: false,
      description: '',
      descriptionMarkdown: '',
      documentationLinks: [{ uri: 'old' }],
    };
    const ctx = { getNodeByIdAsync: async () => node } as unknown as typeof figma;
    await createUpdateComponentHandler(ctx)({
      componentId: 'c',
      descriptionMarkdown: '**Usage**',
      documentationLinks: [],
    });
    expect(node.descriptionMarkdown).toBe('**Usage**');
    expect(node.documentationLinks).toEqual([]);
    expect(set.description).toBe('set docs');
    expect(componentDocumentation(node as unknown as ComponentNode)).toEqual({
      descriptionMarkdown: '**Usage**',
    });
    node.descriptionMarkdown = '';
    expect(componentDocumentation(node as unknown as ComponentNode)).toEqual({});
  });
  it('puts the description back when Figma refuses the links, and reports both failures', async () => {
    const make = (restoreFails: boolean) => {
      const state = { description: 'old', links: [] as unknown[] };
      return {
        state,
        node: {
          id: 'c',
          type: 'COMPONENT',
          remote: false,
          get description() {
            return state.description;
          },
          set description(v: string) {
            if (restoreFails && v === 'old') throw new Error('restore boom');
            state.description = v;
          },
          get documentationLinks() {
            return state.links;
          },
          set documentationLinks(_v: unknown[]) {
            throw new Error('links refused');
          },
        },
      };
    };
    const run = (node: unknown) =>
      createUpdateComponentHandler({
        getNodeByIdAsync: async () => node,
      } as unknown as typeof figma)({
        componentId: 'c',
        description: 'new',
        documentationLinks: [{ uri: 'https://a.example' }],
      });

    const ok = make(false);
    await expect(run(ok.node)).rejects.toThrow('links refused');
    expect(ok.state.description).toBe('old');

    const bad = make(true);
    await expect(run(bad.node)).rejects.toThrow(
      /links refused.*could not be restored \(restore boom\)/,
    );
  });
  it('refuses an unparseable link uri before writing anything', async () => {
    const node = { id: 'c', type: 'COMPONENT', remote: false, description: 'keep' };
    const handler = createUpdateComponentHandler({
      getNodeByIdAsync: async () => node,
    } as unknown as typeof figma);
    await expect(
      handler({ componentId: 'c', description: 'x', documentationLinks: [{ uri: 'not a url' }] }),
    ).rejects.toThrow(/not a valid URL/);
    expect(node.description).toBe('keep');
  });
  it('emits descriptionMarkdown only when it differs from description', () => {
    const doc = (description: string, descriptionMarkdown: string) =>
      componentDocumentation({ description, descriptionMarkdown } as unknown as ComponentNode);
    expect(doc('plain', 'plain')).toEqual({ description: 'plain' });
    expect(doc('Usage', '**Usage**')).toEqual({
      description: 'Usage',
      descriptionMarkdown: '**Usage**',
    });
    expect(doc('', '')).toEqual({});
    expect(doc('plain', '')).toEqual({ description: 'plain' });
  });
  it('rejects incompatible or remote writes before mutation', async () => {
    const node = { id: 'c', type: 'COMPONENT_SET', remote: true, description: 'keep' };
    const handler = createUpdateComponentHandler({
      getNodeByIdAsync: async () => node,
    } as unknown as typeof figma);
    await expect(
      handler({ componentId: 'c', description: 'a', descriptionMarkdown: 'b' }),
    ).rejects.toThrow(/not both/);
    await expect(
      handler({ componentId: 'c', documentationLinks: [{ uri: 'a' }, { uri: 'b' }] }),
    ).rejects.toThrow(/at most one/);
    await expect(handler({ componentId: 'c', description: 'a' })).rejects.toThrow(/read-only/);
    expect(node.description).toBe('keep');
  });
});

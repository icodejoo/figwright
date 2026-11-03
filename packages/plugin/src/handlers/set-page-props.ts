import type { SandboxToolHandler } from '../dispatcher.js';
export const createSetPagePropsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { pageId: string; index?: number; backgrounds?: SolidPaint[] };
    const page = await figmaCtx.getNodeByIdAsync(p.pageId);
    if (page?.type !== 'PAGE') throw new Error(`set_page_props: page ${p.pageId} not found`);
    if (
      p.index !== undefined &&
      (!Number.isInteger(p.index) || p.index < 0 || p.index >= figmaCtx.root.children.length)
    )
      throw new Error('set_page_props: index outside document page list');
    if (p.backgrounds !== undefined) page.backgrounds = p.backgrounds;
    if (p.index !== undefined) {
      // insertChild counts the index before removing an existing child (measured).
      const current = figmaCtx.root.children.indexOf(page);
      if (current !== p.index)
        figmaCtx.root.insertChild(p.index + (current < p.index ? 1 : 0), page);
    }
    return { ok: true, nodeId: page.id };
  };

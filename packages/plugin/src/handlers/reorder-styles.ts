import type { SandboxToolHandler } from '../dispatcher.js';
import { styleFolder, type StyleKind, styleOrderApi } from './style-order.js';

export const createReorderStylesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { kind: StyleKind; styleId: string; afterStyleId?: string | null };
    const api = styleOrderApi(figmaCtx, p.kind);
    const target = await figmaCtx.getStyleByIdAsync(p.styleId);
    const reference =
      p.afterStyleId == null ? null : await figmaCtx.getStyleByIdAsync(p.afterStyleId);
    if (target === null || (p.afterStyleId != null && reference === null))
      throw new Error('reorder_styles: style not found');
    if (target.remote || reference?.remote) throw new Error('reorder_styles: styles must be local');
    if (target.type !== api.type || (reference !== null && reference.type !== api.type))
      throw new Error('reorder_styles: style kind mismatch');
    if (reference !== null && styleFolder(target.name) !== styleFolder(reference.name))
      throw new Error('reorder_styles: styles must be in the same folder');
    if (target.id === reference?.id)
      throw new Error('reorder_styles: target cannot reference itself');
    api.move(target, reference);
    return { ok: true, styleId: target.id };
  };

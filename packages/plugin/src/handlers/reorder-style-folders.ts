import type { SandboxToolHandler } from '../dispatcher.js';
import { siblingFolders, styleFolder, type StyleKind, styleOrderApi } from './style-order.js';

export const createReorderStyleFoldersHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { kind: StyleKind; folder: string; afterFolder?: string | null };
    const api = styleOrderApi(figmaCtx, p.kind);
    const reference = p.afterFolder ?? null;
    const parent = styleFolder(p.folder);
    if (
      p.folder === '' ||
      p.folder.endsWith('/') ||
      p.folder.startsWith('/') ||
      p.folder.includes('//')
    )
      throw new Error(
        'reorder_style_folders: use a full nonempty folder path without empty segments',
      );
    if (reference !== null && (styleFolder(reference) !== parent || reference === p.folder))
      throw new Error('reorder_style_folders: reference must be a different sibling folder');
    const folders = siblingFolders(await api.list(), parent);
    if (!folders.includes(p.folder) || (reference !== null && !folders.includes(reference)))
      throw new Error('reorder_style_folders: folder not found for this kind');
    api.moveFolder(p.folder, reference);
    return { ok: true, folder: p.folder };
  };

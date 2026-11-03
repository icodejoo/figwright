import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * A page divider name is one repeated character: all asterisks, all en dashes, all em dashes or all
 * spaces (Figma's default "---" is hyphens). Figma does not refuse anything else on rename — it
 * just makes an ordinary page — so a bad name has to be caught before creating (measured live).
 */
const DIVIDER_NAME = /^(?:\*+|–+|—+| +|-+)$/;

/** Create a new page (optionally named). Returns the new page's id / name / type. */
export const createAddPageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; divider?: boolean };
    if (p.divider === true && typeof p.name === 'string' && !DIVIDER_NAME.test(p.name))
      throw new Error(
        'add_page: a page divider name must be all asterisks, all en dashes, all em dashes or all spaces (default "---")',
      );
    const page =
      p.divider === true
        ? figmaCtx.createPageDivider(typeof p.name === 'string' ? p.name : undefined)
        : figmaCtx.createPage();
    if (typeof p.name === 'string') page.name = p.name;

    const result: CreateResult = { ok: true, nodeId: page.id, name: page.name, type: page.type };
    return result;
  };

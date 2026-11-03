import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createAddPageHandler } from '../../src/handlers/add-page.js';

const fakeFigma = (): { figma: typeof figma; page: Record<string, unknown> } => {
  const page: Record<string, unknown> = { id: 'P:1', name: 'Page 1', type: 'PAGE' };
  const figmaCtx = { createPage: () => page } as unknown as typeof figma;
  return { figma: figmaCtx, page };
};

describe('add_page handler', () => {
  it('creates a page and applies an optional name', async () => {
    const { figma: f, page } = fakeFigma();
    const result = (await createAddPageHandler(f)({ name: 'Specs' })) as CreateResult;
    expect(page.name).toBe('Specs');
    expect(result).toEqual({ ok: true, nodeId: 'P:1', name: 'Specs', type: 'PAGE' });
  });

  it('keeps the default name when none is given', async () => {
    const { figma: f } = fakeFigma();
    const result = (await createAddPageHandler(f)({})) as CreateResult;
    expect(result).toEqual({ ok: true, nodeId: 'P:1', name: 'Page 1', type: 'PAGE' });
  });
});

it('creates a divider through the dedicated API and preserves native page limit errors', async () => {
  const page = { id: 'divider', name: '---', type: 'PAGE' };
  const ctx = {
    createPageDivider: (name?: string) => ({ ...page, name: name ?? page.name }),
  } as unknown as typeof figma;
  expect(await createAddPageHandler(ctx)({ divider: true })).toEqual({
    ok: true,
    nodeId: 'divider',
    name: '---',
    type: 'PAGE',
  });
  expect(await createAddPageHandler(ctx)({ divider: true, name: '***' })).toEqual({
    ok: true,
    nodeId: 'divider',
    name: '***',
    type: 'PAGE',
  });
  const restricted = {
    createPageDivider: () => {
      throw new Error('The Starter plan only comes with 3 pages');
    },
  } as unknown as typeof figma;
  await expect(createAddPageHandler(restricted)({ divider: true })).rejects.toThrow('Starter');
});

it('refuses a divider name that would silently become an ordinary page', async () => {
  const createPage = vi.fn<() => void>();
  const createPageDivider = vi.fn<() => void>();
  const ctx = { createPage, createPageDivider } as unknown as typeof figma;
  await expect(createAddPageHandler(ctx)({ divider: true, name: 'abc' })).rejects.toThrow(
    /all asterisks/,
  );
  await expect(createAddPageHandler(ctx)({ divider: true, name: '*-' })).rejects.toThrow(
    /all asterisks/,
  );
  expect(createPage).not.toHaveBeenCalled();
  expect(createPageDivider).not.toHaveBeenCalled();
});

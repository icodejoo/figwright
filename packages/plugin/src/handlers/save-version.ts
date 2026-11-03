import type { SandboxToolHandler } from '../dispatcher.js';
export const createSaveVersionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as { title: string; description?: string };
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    return { version: await figmaCtx.saveVersionHistoryAsync(p.title, p.description) };
  };

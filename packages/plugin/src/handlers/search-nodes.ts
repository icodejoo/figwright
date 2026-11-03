import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createSearchNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      type?: unknown;
      root?: unknown;
      pluginData?: { keys?: string[] };
      sharedPluginData?: { namespace: string; keys?: string[] };
    };
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new TypeError('search_nodes: name must be a string');
    }
    if (p.type !== undefined && typeof p.type !== 'string') {
      throw new TypeError('search_nodes: type must be a string');
    }
    if (
      p.name === undefined &&
      p.type === undefined &&
      p.pluginData === undefined &&
      p.sharedPluginData === undefined
    ) {
      throw new TypeError(
        'search_nodes: at least one of name, type, pluginData or sharedPluginData is required',
      );
    }

    const needle = typeof p.name === 'string' ? p.name.toLowerCase() : null;
    const wantType = typeof p.type === 'string' ? p.type : null;
    const scope = await resolveScope(figmaCtx, p.root);

    // Type first: `name` is a native getter, and a node the type already excludes need not pay it.
    const hasData = (node: SceneNode): boolean => {
      if (p.pluginData !== undefined) {
        const keys = node.getPluginDataKeys();
        if (
          !(p.pluginData.keys === undefined
            ? keys.length > 0
            : p.pluginData.keys.some(key => keys.includes(key)))
        )
          return false;
      }
      if (p.sharedPluginData !== undefined) {
        const keys = node.getSharedPluginDataKeys(p.sharedPluginData.namespace);
        if (
          !(p.sharedPluginData.keys === undefined
            ? keys.length > 0
            : p.sharedPluginData.keys.some(key => keys.includes(key)))
        )
          return false;
      }
      return true;
    };
    const matches = await collectMatches(
      scope,
      node =>
        (wantType === null || node.type === wantType) &&
        (needle === null || node.name.toLowerCase().includes(needle)) &&
        hasData(node),
      perfFor(figmaCtx),
    );
    return toNodeListResult(
      matches,
      await serializeFlatNodes(matches, resultCharBudget(), perfFor(figmaCtx)),
    );
  };

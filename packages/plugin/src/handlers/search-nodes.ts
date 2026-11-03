import type { BriefSearchNode } from '@figwright/shared';

import { TimeSlice } from '../cooperative.js';
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
      brief?: boolean;
      limit?: number;
      pluginData?: { keys?: string[] };
      sharedPluginData?: { namespace: string; keys?: string[] };
    };
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new TypeError('search_nodes: name must be a string');
    }
    if (p.type !== undefined && typeof p.type !== 'string') {
      throw new TypeError('search_nodes: type must be a string');
    }
    if (p.brief !== undefined && typeof p.brief !== 'boolean') {
      throw new TypeError('search_nodes: brief must be a boolean');
    }
    if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 10000)) {
      throw new TypeError('search_nodes: limit must be an integer from 1 to 10000');
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
      p.limit,
    );
    const capped = p.limit !== undefined && matches.length === p.limit;
    if (p.brief === true) {
      const nodes: BriefSearchNode[] = [];
      const slice = new TimeSlice(perfFor(figmaCtx));
      for (const node of matches) {
        // Only basic identity/visibility getters: no geometry, paints or async component reads.
        const parent = node.parent;
        nodes.push({
          id: node.id,
          name: node.name,
          type: node.type,
          parentId: parent?.id ?? null,
          visible: node.visible,
        });
        // eslint-disable-next-line no-await-in-loop -- native getters still need cooperative slices
        if (slice.due()) await slice.yield();
      }
      return capped ? { nodes, truncated: true } : { nodes };
    }
    const result = toNodeListResult(
      matches,
      await serializeFlatNodes(matches, resultCharBudget(), perfFor(figmaCtx)),
    );
    return capped ? { ...result, truncated: true } : result;
  };

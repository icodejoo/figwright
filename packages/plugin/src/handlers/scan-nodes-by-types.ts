import { briefNodes, validateBriefRead } from '../brief-nodes.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createScanNodesByTypesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      types?: unknown;
      root?: unknown;
      brief?: boolean;
      limit?: number;
    };
    if (
      !Array.isArray(p.types) ||
      p.types.length === 0 ||
      p.types.some(t => typeof t !== 'string')
    ) {
      throw new TypeError('scan_nodes_by_types: types must be a non-empty string[]');
    }
    validateBriefRead('scan_nodes_by_types', p);
    const types = new Set(p.types as readonly string[]);
    const scope = await resolveScope(figmaCtx, p.root);

    const matches = await collectMatches(
      scope,
      node => types.has(node.type),
      perfFor(figmaCtx),
      p.limit,
    );
    const capped = p.limit !== undefined && matches.length === p.limit;
    if (p.brief === true) {
      const nodes = await briefNodes(matches, perfFor(figmaCtx), false);
      return capped ? { nodes, truncated: true } : { nodes };
    }
    const result = toNodeListResult(
      matches,
      await serializeFlatNodes(matches, resultCharBudget(), perfFor(figmaCtx)),
    );
    return capped ? { ...result, truncated: true } : result;
  };

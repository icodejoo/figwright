import { briefNodes, validateBriefRead } from '../brief-nodes.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { root?: unknown; brief?: boolean; limit?: number };
    validateBriefRead('scan_text_nodes', p);
    const scope = await resolveScope(figmaCtx, p.root);

    // Text set along a path is copy too — the wording of a badge or a seal.
    const matches = await collectMatches(
      scope,
      node => node.type === 'TEXT' || node.type === 'TEXT_PATH',
      perfFor(figmaCtx),
      p.limit,
    );
    const capped = p.limit !== undefined && matches.length === p.limit;
    if (p.brief === true) {
      const nodes = await briefNodes(matches, perfFor(figmaCtx), true);
      return capped ? { nodes, truncated: true } : { nodes };
    }
    const result = toNodeListResult(
      matches,
      await serializeFlatNodes(matches, resultCharBudget(), perfFor(figmaCtx)),
    );
    return capped ? { ...result, truncated: true } : result;
  };

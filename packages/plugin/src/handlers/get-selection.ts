import type { GetSelectionResult } from '@figwright/shared';

import { briefNodes, validateBriefRead } from '../brief-nodes.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import { RESULT_LIMIT_LABEL, resultCharBudget, serializeFlatNodes } from '../serializer.js';

export const createGetSelectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { brief?: boolean };
    validateBriefRead('get_selection', p);
    const page = figmaCtx.currentPage;
    const selection = page.selection;
    if (p.brief === true)
      return {
        pageId: page.id,
        pageName: page.name,
        nodes: await briefNodes(selection, perfFor(figmaCtx)),
      };
    const run = await serializeFlatNodes(selection, resultCharBudget(), perfFor(figmaCtx));
    // Refused rather than cut: the selection is the caller's statement of what to work on, and a
    // part of it would read as all of it.
    if (!run.complete) {
      throw new Error(
        `get_selection: the ${selection.length} selected layers serialize past ` +
          `${RESULT_LIMIT_LABEL} — more than one tool result can carry. Select fewer layers, or ` +
          'read the frames you need one at a time with get_design_context.',
      );
    }
    const result: GetSelectionResult = {
      pageId: page.id,
      pageName: page.name,
      nodes: run.nodes,
    };
    return result;
  };

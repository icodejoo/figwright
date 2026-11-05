import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_NODE_VARIABLE_MODE_TOOL_NAME = 'set_node_variable_mode';

export const setNodeVariableModeTool: ToolSpec = {
  name: SET_NODE_VARIABLE_MODE_TOOL_NAME,
  description:
    "Switch a node to one of a variable collection's modes — the Dark (or another theme, brand or " +
    'language) variant of a frame, a component, a layer inside an instance, or a whole page — so ' +
    "every variable bound in its subtree takes that mode's value. This changes which mode a node " +
    'renders in; to add or ' +
    'remove modes on the collection itself use add_variable_mode / delete_variable_mode. collectionId ' +
    'and modeId come from get_variable_defs; for a collection that lives in a library, pass its key or ' +
    '"library/collection" from list_team_library as collectionId and a mode name (e.g. "Dark") as modeId. modeId null clears the setting so the node inherits its ' +
    "parent's mode again. Returns { ok, nodeId, collectionId, collectionName, modeId, modeName }.",
  inputSchema: z.object({
    nodeId: z.string().describe('Node to switch: any layer, or a page'),
    collectionId: z
      .string()
      .describe(
        'Variable collection id from get_variable_defs, or a library collection key / "library/collection" from list_team_library',
      ),
    modeId: z
      .string()
      .nullable()
      .describe(
        "A mode id (or, for a library collection, a mode name such as Dark); null clears it so the node inherits its parent's",
      ),
  }),
  kind: 'write',
};

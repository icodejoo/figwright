import { z } from 'zod';

import { VARIABLE_SCOPES } from './create-variable.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_VARIABLE_TOOL_NAME = 'update_variable';

export const updateVariableTool: ToolSpec = {
  name: UPDATE_VARIABLE_TOOL_NAME,
  description:
    "Edit a variable's metadata in place: description (the note shown beside the token — what it " +
    'is for), scopes (where Figma offers it in its picker, e.g. ["CORNER_RADIUS"]; ["ALL_SCOPES"] ' +
    'resets it) and hiddenFromPublishing (keep a base token such as a palette colour out of the ' +
    'library when the file is published). Any field may be omitted to leave it unchanged. The id, ' +
    'name, values and every binding are untouched — this is the way to fix a mis-scoped token, ' +
    'where deleting and recreating it would mint a new id and break every binding. To rename use ' +
    'rename_variable; to keep a whole collection out of publishing use update_variable_collection. ' +
    'Fails, writing nothing, when the scopes do not fit the variable type (CORNER_RADIUS on a ' +
    'COLOR, any scope on EASING / TIMING) or when hiddenFromPublishing is true on a variable from ' +
    'a library (only local variables can be hidden). Returns { ok, variableId, name, description, ' +
    'scopes, hiddenFromPublishing } as the variable now stands.',
  inputSchema: z.object({
    variableId: z.string().describe('Variable id, from get_variable_defs'),
    description: z
      .string()
      .optional()
      .describe('Note describing what the token is for; "" clears it'),
    scopes: z
      .array(z.enum(VARIABLE_SCOPES))
      .nonempty()
      .optional()
      .describe(
        'Where Figma offers this variable in its picker. ["ALL_SCOPES"] means everywhere ' +
          "(Figma's default). Not available for EASING / TIMING",
      ),
    hiddenFromPublishing: z
      .boolean()
      .optional()
      .describe('true keeps the variable out of a published library; false restores it'),
  }),
  kind: 'write',
};

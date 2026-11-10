import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REBUILD_ORPHAN_BUTTONS_TOOL_NAME = 'rebuild_orphan_buttons';

export const rebuildOrphanButtonsTool: ToolSpec = {
  name: REBUILD_ORPHAN_BUTTONS_TOOL_NAME,
  description:
    'Rebuild button instances whose main component was deleted (ghost instances that only show a cached ' +
    'picture and cannot be edited: get_node fails with "Backing component for node not found"). Scans root ' +
    'for instances with no main component and a visible TEXT layer named labelLayerName (default "Button"), ' +
    'reads label, size and fill, and recreates each one in the same parent and position as an instance of ' +
    'the published button buttonKey, with Label and the four mode collections (type / style / size / state, ' +
    'by library collection key) set; type is guessed from the fill (orange Primary, red Danger, white ' +
    'Default, none = Text style), size from the height, state from opacity. Ghosts nested inside another ' +
    'instance cannot be changed on their own and are only counted: fix the component that contains them. ' +
    'dryRun defaults to true and returns the plan without touching the file. Returns { ok, dryRun, scanned, ' +
    'nestedSkipped, found | rebuilt, plans | failed }.',
  inputSchema: z.object({
    root: z.string().describe('Node id to scan: a page, frame, or component'),
    buttonKey: z.string().describe('Published component key of the library Button'),
    modeCollections: z
      .object({
        type: z.string().describe('Library collection key for the button type modes'),
        style: z.string().describe('Library collection key for the button style modes'),
        size: z.string().describe('Library collection key for the button size modes'),
        state: z.string().describe('Library collection key for the button state modes'),
      })
      .describe(
        'Library variable collection keys; modes are looked up by name (Primary, Solid, Large, …)',
      ),
    labelLayerName: z
      .string()
      .optional()
      .describe('Name of the TEXT layer holding the label (default "Button")'),
    dryRun: z.boolean().optional().describe('Return the plan only (default true)'),
  }),
  kind: 'write',
};

import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_AUTO_LAYOUT_TOOL_NAME = 'set_auto_layout';

// One grid track, in the same { type, value } shape get_node / get_design_context read back as
// gridRowSizes / gridColumnSizes: FLEX is a CSS fr fraction, FIXED a pixel size, HUG fits content.
const gridTrackSchema = z.object({
  type: z.enum(['FLEX', 'FIXED', 'HUG']),
  value: z
    .number()
    .positive()
    .optional()
    .describe(
      'FIXED: the track size in px (required). FLEX: the fr fraction, 1 when omitted. HUG: omit',
    ),
});

export const setAutoLayoutTool: ToolSpec = {
  name: SET_AUTO_LAYOUT_TOOL_NAME,
  description:
    "Configure a frame's auto layout. layoutMode NONE disables it; HORIZONTAL/VERTICAL enable flex " +
    '(padding / itemSpacing / alignment / wrap, plus counterAxisSpacing / counterAxisAlignContent ' +
    'for the wrapped cross axis — the CSS row-gap (column-gap when VERTICAL) / align-content — and ' +
    'itemReverseZIndex / ' +
    'strokesIncludedInLayout for paint order and stroke-in-layout); GRID enables CSS-Grid-style ' +
    'layout (padding / gridRowCount / gridColumnCount / gridRowGap / gridColumnGap, plus ' +
    'gridItemsPositioning / gridAutoTracks for children that flow into cells by order and rows ' +
    'that grow with them), and gridRowSizes / gridColumnSizes to size each track — one ' +
    '{ type: FLEX | FIXED | HUG, value? } per row / column, in order (the same shape the reads ' +
    'report). To place or span one child use set_grid_child; to move whole rows / columns use ' +
    'reorder_grid_tracks. Setting GRID on a frame that is already a grid keeps its tracks and ' +
    'placements. ' +
    'Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string(),
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    // HORIZONTAL / VERTICAL
    itemSpacing: z.number().optional(),
    primaryAxisAlignItems: z
      .enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN', 'SPACE_EVENLY', 'SPACE_AROUND'])
      .optional()
      .describe(
        'Main-axis distribution (CSS justify-content). MIN / CENTER / MAX pack the children; ' +
          'the SPACE_* values spread them — SPACE_BETWEEN puts the extra space only between ' +
          'children (first and last flush with the edges), SPACE_EVENLY makes every gap equal ' +
          'including the two edge gaps, SPACE_AROUND gives each child equal space on both sides ' +
          'so the edge gaps are half the gaps between children',
      ),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
    counterAxisSpacing: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Cross-axis gap between wrapped tracks (px): rows of a HORIZONTAL wrap (CSS row-gap), ' +
          'columns of a VERTICAL one (CSS column-gap). Requires layoutWrap WRAP (settable in the ' +
          'same call); ignored under counterAxisAlignContent SPACE_BETWEEN',
      ),
    counterAxisAlignContent: z
      .enum(['AUTO', 'SPACE_BETWEEN'])
      .optional()
      .describe(
        'How wrapped tracks distribute along the cross axis: AUTO packs them at ' +
          'counterAxisSpacing, SPACE_BETWEEN spreads them (align-content). Requires layoutWrap WRAP',
      ),
    itemReverseZIndex: z
      .boolean()
      .optional()
      .describe(
        'Paint later siblings UNDER earlier ones (reversed canvas order) — the stacked-avatars / ' +
          'overlapping-cards pattern, usually with negative itemSpacing. HORIZONTAL/VERTICAL only',
      ),
    strokesIncludedInLayout: z
      .boolean()
      .optional()
      .describe(
        'Make strokes take up layout space (gaps/padding grow by the stroke weight); Figma ' +
          'defaults to excluding them. HORIZONTAL/VERTICAL only',
      ),
    // GRID
    gridRowCount: z.number().int().positive().optional(),
    gridColumnCount: z.number().int().positive().optional(),
    gridRowGap: z.number().optional(),
    gridColumnGap: z.number().optional(),
    gridItemsPositioning: z
      .enum(['MANUAL', 'ROW_AUTO_FLOW'])
      .optional()
      .describe(
        'How children take cells: MANUAL (the default) pins each child to its own cell; ' +
          'ROW_AUTO_FLOW places them by layer order, left to right then top to bottom ' +
          '(CSS grid-auto-flow: row) — a list rendered from data. GRID only',
      ),
    gridRowSizes: z
      .array(gridTrackSchema)
      .optional()
      .describe(
        'Size of every row, top to bottom — the array must be exactly as long as the row count ' +
          '(gridRowCount of this call, else the current one of a frame that is already a grid; ' +
          'checked before anything is written). Not checkable up front when the frame is not a ' +
          'grid yet and this call gives no gridRowCount, or while gridAutoTracks is ROWS: the ' +
          'length is then judged by Figma, and a failure can leave the frame already switched ' +
          'to GRID (retry, or restore by hand). Passing it with a layoutMode other than GRID is an ' +
          'error. A FLEX track is not valid while the frame HUGs that axis (layoutSizing ' +
          'HUG): use FIXED or HUG tracks there, or make the axis FIXED / FILL first. GRID only',
      ),
    gridColumnSizes: z
      .array(gridTrackSchema)
      .optional()
      .describe(
        'Size of every column, left to right — exactly as long as the column count (gridColumnCount of this call, else the current one of a frame that is already a grid; ' +
          'when the frame is not a grid yet and no gridColumnCount is given, Figma judges the length and a failure can leave the frame already switched to GRID). ' +
          'Same FLEX / HUG rule as ' +
          'gridRowSizes. GRID only',
      ),
    gridAutoTracks: z
      .enum(['NONE', 'ROWS'])
      .optional()
      .describe(
        'NONE (the default) keeps gridRowCount; ROWS adds and removes rows as children come and ' +
          'go (CSS grid-auto-rows), and Figma then owns the row count, so gridRowCount is refused ' +
          'unless this call sets NONE. GRID only',
      ),
  }),
  kind: 'write',
};

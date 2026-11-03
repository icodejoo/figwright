import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const exportNodeDataTool: ToolSpec = {
  name: 'export_node_data',
  kind: 'read',
  description:
    'Export a node with Figma exportAsync: SVG_STRING returns an SVG string ready to inline; JSON_REST_V1 returns REST-shaped JSON for comparison with REST API data (not Figwright serialization). Returns {nodeId, format, data}, data is a string or object. All optional export settings apply only to SVG_STRING; JSON_REST_V1 accepts none. SVG text outlines default true (false relies on client fonts); id attributes default false; stroke simplification defaults true. Oversized results are refused intact before transport; export a smaller node. With dynamic-page, JSON_REST_V1 may require the page to be loaded: use load_page first if Figma requests it. Native errors are preserved.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node to export'),
    format: z.enum(['SVG_STRING', 'JSON_REST_V1']),
    contentsOnly: z.boolean().optional(),
    useAbsoluteBounds: z.boolean().optional(),
    suffix: z.string().optional(),
    svgOutlineText: z.boolean().optional(),
    svgIdAttribute: z.boolean().optional(),
    svgSimplifyStroke: z.boolean().optional(),
    colorProfile: z.enum(['DOCUMENT', 'SRGB', 'DISPLAY_P3_V4']).optional(),
  }),
};

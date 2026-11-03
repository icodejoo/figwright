import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_IMAGE_FILL_TOOL_NAME = 'set_image_fill';

export const setImageFillTool: ToolSpec = {
  name: SET_IMAGE_FILL_TOOL_NAME,
  description:
    "Put a raster image (PNG / JPG / GIF) into an existing node's fills — a photo into a card " +
    "cover, an avatar into a circle — keeping the node's size, position, corners, effects and " +
    'constraints. import_image instead creates a new rectangle. Provide exactly one of path (a ' +
    'local file the server reads; preferred, the bytes never pass through the conversation), data ' +
    '(base64) or url (fetched by Figma, so it must be publicly reachable). Figma accepts at most ' +
    '4096px in width and height. Without index, the topmost IMAGE fill gets the new image and ' +
    "keeps its crop, filters and scale mode, like Figma's Replace image; a node without one gets " +
    'the image added on top of its fills. With index (0 = the bottom fill, the order get_node ' +
    'lists them in), that fill is replaced. scaleMode is FILL / FIT / CROP / TILE (default: keep ' +
    "the replaced image's, else FILL). Setting fills unlinks a fill style. Returns { ok, nodeId, " +
    'index, imageHash, width, height } — the fill it wrote and the image size in pixels.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node whose fills take the image (frame, shape or text)'),
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Local image file (PNG / JPEG / GIF), read by the MCP server; relative paths resolve ' +
          'against its working directory',
      ),
    data: z.string().optional().describe('Base64-encoded image bytes (PNG / JPG / GIF)'),
    url: z.string().optional().describe('Image URL to fetch instead of data'),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Fill to replace, 0 = bottom (default: the topmost IMAGE fill, else add on top)'),
    filters: z
      .object({
        exposure: z.number().min(-1).max(1).optional(),
        contrast: z.number().min(-1).max(1).optional(),
        saturation: z.number().min(-1).max(1).optional(),
        temperature: z.number().min(-1).max(1).optional(),
        tint: z.number().min(-1).max(1).optional(),
        highlights: z.number().min(-1).max(1).optional(),
        shadows: z.number().min(-1).max(1).optional(),
      })
      .optional()
      .describe('Image filter sliders, -1..1; merges supplied sliders into existing filters'),
    imageTransform: z
      .array(z.array(z.number()).min(3).max(3))
      .min(2)
      .max(2)
      .optional()
      .describe('2x3 affine transform; requires effective scaleMode CROP'),
    rotation: z
      .number()
      .int()
      .optional()
      .describe('Degrees in increments of 90; requires FILL/FIT/TILE'),
    scalingFactor: z
      .number()
      .positive()
      .optional()
      .describe('Tile scale; requires effective scaleMode TILE'),
    blendMode: z.string().optional().describe('Paint compositing mode, validated by Figma'),
    scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  }),
  kind: 'write',
  // Resolved on the server into `data` before dispatch, so the sandbox handler never receives it.
  serverOnlyArgs: ['path'],
};

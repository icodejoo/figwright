import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_SVG_TOOL_NAME = 'import_svg';

export const importSvgTool: ToolSpec = {
  name: IMPORT_SVG_TOOL_NAME,
  description:
    'Import an SVG and place it as editable vector nodes (a FRAME of VECTOR paths) via ' +
    "createNodeFromSvg — use this for vector logos, brand marks, and icons. Provide the SVG's raw " +
    'markup string (read it from the project asset, or inline it). The frame defaults to the SVG ' +
    'intrinsic size unless width/height are given. For raster photos (PNG / JPG) use import_image, ' +
    'or set_image_fill to fill an existing layer, instead; when a matching icon component already exists, create_instance it rather than re-pasting ' +
    'the SVG. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    svg: z
      .string()
      .optional()
      .describe('Raw SVG markup, e.g. "<svg …>…</svg>" (or pass path instead)'),
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A local .svg file the server reads instead of svg; use it for large traced SVGs that cannot travel as an inline argument',
      ),
    name: z.string().optional().describe('Optional name for the new node'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: SVG intrinsic width)'),
    height: z.number().optional().describe('Override height (default: SVG intrinsic height)'),
  }),
  kind: 'write',
  serverOnlyArgs: ['path'],
};

/**
 * Turns an `import_svg` call that names a `path` into one that carries the markup, so the sandbox
 * only ever sees `svg`. Exactly one of `svg` and `path` is required.
 *
 * @param rawArgs - The tool arguments as validated by {@link importSvgTool}'s schema.
 * @returns The arguments without `path` and with `svg` filled in.
 * @throws When both or neither of `svg` and `path` are given, or the file cannot be read.
 */
export const resolveSvgPath = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
  const { path, ...rest } = rawArgs as { path?: string; svg?: string } & Record<string, unknown>;
  if (path !== undefined && rest.svg !== undefined) {
    throw new Error('import_svg: provide either svg or path, not both');
  }
  if (path === undefined) {
    if (typeof rest.svg !== 'string') throw new Error('import_svg: provide svg or path');
    return rest;
  }
  return { ...rest, svg: await readFile(resolve(path), 'utf8') };
};

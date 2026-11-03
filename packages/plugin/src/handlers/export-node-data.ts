import { NODE_LIST_BUDGET_BYTES } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const SVG_KEYS = [
  'contentsOnly',
  'useAbsoluteBounds',
  'suffix',
  'svgOutlineText',
  'svgIdAttribute',
  'svgSimplifyStroke',
  'colorProfile',
] as const;

// UTF-8 bytes after this JSON becomes an MCP text block (one further JSON escape).
// No browser TextEncoder / URL globals are assumed in the sandbox.
const textWireBytes = (json: string): number => {
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c === 34 || c === 92) bytes += 2;
    else if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      json.charCodeAt(i + 1) >= 0xdc00 &&
      json.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};
export const createExportNodeDataHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId: string; format: 'SVG_STRING' | 'JSON_REST_V1' } & Partial<
      Omit<ExportSettingsSVGString, 'format'>
    >;
    if (typeof p.nodeId !== 'string')
      throw new TypeError('export_node_data: nodeId must be a string');
    if (p.format !== 'SVG_STRING' && p.format !== 'JSON_REST_V1')
      throw new TypeError('export_node_data: format must be SVG_STRING or JSON_REST_V1');
    const settings: Record<string, unknown> = { format: p.format };
    for (const key of SVG_KEYS) {
      if (p[key] === undefined) continue;
      if (p.format !== 'SVG_STRING')
        throw new TypeError(`export_node_data: ${key} is only supported for SVG_STRING`);
      if (
        key === 'colorProfile'
          ? !['DOCUMENT', 'SRGB', 'DISPLAY_P3_V4'].includes(p[key] as string)
          : typeof p[key] !== (key === 'suffix' ? 'string' : 'boolean')
      )
        throw new TypeError(`export_node_data: invalid ${key}`);
      settings[key] = p[key];
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('exportAsync' in node))
      throw new Error(`export_node_data: node ${p.nodeId} not found or does not support export`);
    // Keep the overload explicit so typings check both return types; no catch that rewrites native errors.
    const data =
      p.format === 'SVG_STRING'
        ? await node.exportAsync(settings as unknown as ExportSettingsSVGString)
        : await node.exportAsync({ format: 'JSON_REST_V1' });
    const result = { nodeId: node.id, format: p.format, data };
    if (textWireBytes(JSON.stringify(result)) > NODE_LIST_BUDGET_BYTES)
      throw new Error(
        'export_node_data: exported data exceeds the tool result budget (about 10 MiB on the wire); result refused without truncation. Export a smaller node or subtree.',
      );
    return result;
  };

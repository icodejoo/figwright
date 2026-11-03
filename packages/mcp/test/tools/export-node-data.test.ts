import { expect, it } from 'vitest';

import { exportNodeDataTool } from '../../src/tools/export-node-data.js';
it('advertises supported formats and SVG-only optional fields', () => {
  expect(exportNodeDataTool.kind).toBe('read');
  for (const format of ['SVG_STRING', 'JSON_REST_V1'])
    expect(exportNodeDataTool.inputSchema.safeParse({ nodeId: '1:2', format }).success).toBe(true);
  expect(exportNodeDataTool.inputSchema.safeParse({ nodeId: '1:2', format: 'PNG' }).success).toBe(
    false,
  );
  expect(
    exportNodeDataTool.inputSchema.safeParse({
      nodeId: '1:2',
      format: 'SVG_STRING',
      svgOutlineText: false,
      colorProfile: 'DISPLAY_P3_V4',
    }).success,
  ).toBe(true);
});

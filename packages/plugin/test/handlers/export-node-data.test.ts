import { NODE_LIST_BUDGET_BYTES } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createExportNodeDataHandler } from '../../src/handlers/export-node-data.js';
const setup = (data: unknown) => {
  const exportAsync = vi.fn<() => Promise<unknown>>(async () => data);
  const api = {
    getNodeByIdAsync: async () => ({ id: '1:2', exportAsync }),
  } as unknown as typeof figma;
  return { exportAsync, handler: createExportNodeDataHandler(api) };
};
describe('export_node_data', () => {
  it.each(['SVG_STRING', 'JSON_REST_V1'] as const)('preserves native data for %s', async format => {
    const data =
      format === 'SVG_STRING'
        ? '<svg id="中文">😀</svg>'
        : { document: { id: '1:2', children: [] } };
    const { handler, exportAsync } = setup(data);
    const result = await handler({ nodeId: '1:2', format });
    expect(result).toEqual({ nodeId: '1:2', format, data });
    expect((result as { data: unknown }).data).toBe(data);
    expect(exportAsync).toHaveBeenCalledWith({ format });
  });
  it('passes every supported SVG option verbatim', async () => {
    const { handler, exportAsync } = setup('<svg/>');
    const settings = {
      format: 'SVG_STRING',
      contentsOnly: false,
      useAbsoluteBounds: true,
      suffix: '-test',
      svgOutlineText: false,
      svgIdAttribute: true,
      svgSimplifyStroke: false,
      colorProfile: 'DISPLAY_P3_V4',
    };
    await handler({ nodeId: '1:2', ...settings });
    expect(exportAsync).toHaveBeenCalledWith(settings);
  });
  it('rejects SVG options for REST before exporting', async () => {
    const { handler, exportAsync } = setup({});
    await expect(
      handler({ nodeId: '1:2', format: 'JSON_REST_V1', contentsOnly: false }),
    ).rejects.toThrow('only supported');
    expect(exportAsync).not.toHaveBeenCalled();
  });
  it('preserves original dynamic-page errors', async () => {
    const { handler, exportAsync } = setup({});
    const error = new Error('Page must be loaded first');
    exportAsync.mockRejectedValue(error);
    await expect(handler({ nodeId: '1:2', format: 'JSON_REST_V1' })).rejects.toBe(error);
  });
  it.each(['ascii', 'escaped', 'unicode', 'rest'])(
    'refuses large %s intact before transport',
    async kind => {
      const data =
        kind === 'rest'
          ? { document: 'a'.repeat(NODE_LIST_BUDGET_BYTES) }
          : (kind === 'escaped' ? '"' : kind === 'unicode' ? '中' : 'a').repeat(
              kind === 'unicode'
                ? Math.ceil(NODE_LIST_BUDGET_BYTES / 3)
                : kind === 'escaped'
                  ? Math.ceil(NODE_LIST_BUDGET_BYTES / 4)
                  : NODE_LIST_BUDGET_BYTES,
            );
      await expect(
        setup(data).handler({
          nodeId: '1:2',
          format: kind === 'rest' ? 'JSON_REST_V1' : 'SVG_STRING',
        }),
      ).rejects.toThrow('refused without truncation');
    },
  );
  it('rejects unsupported format and malformed settings', async () => {
    await expect(setup('').handler({ nodeId: '1:2', format: 'PNG' })).rejects.toThrow('format');
    await expect(
      setup('').handler({ nodeId: '1:2', format: 'SVG_STRING', svgOutlineText: 1 }),
    ).rejects.toThrow('invalid');
    await expect(
      createExportNodeDataHandler({
        getNodeByIdAsync: async () => null,
      } as unknown as typeof figma)({ nodeId: 'bad', format: 'SVG_STRING' }),
    ).rejects.toThrow('not found');
  });
});

import { describe, expect, it } from 'vitest';

import { createRebuildOrphanButtonsHandler } from '../../src/handlers/rebuild-orphan-buttons.js';

const MODES = { type: 'kt', style: 'ks', size: 'kz', state: 'ke' };

/** 一个带文字层的实例：mainMissing 为 true 时模拟主组件已被删除（幽灵实例）。 */
const instance = (opts: {
  id: string;
  label: string;
  height: number;
  fill?: { r: number; g: number; b: number };
  mainMissing: boolean;
  parent?: unknown;
}) => {
  const text = { type: 'TEXT', name: 'Button', visible: true, characters: opts.label, fills: [] };
  return {
    id: opts.id,
    type: 'INSTANCE',
    name: 'primary button',
    width: 369,
    height: opts.height,
    opacity: 1,
    fills: opts.fill === undefined ? [] : [{ type: 'SOLID', visible: true, color: opts.fill }],
    parent: opts.parent ?? { id: 'P', type: 'FRAME', children: [], parent: { type: 'PAGE' } },
    findOne: (fn: (n: unknown) => boolean) => (fn(text) ? text : null),
    getMainComponentAsync: async () => (opts.mainMissing ? null : { id: 'main' }),
  };
};

const ctx = (instances: unknown[]): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) =>
      id === 'root' ? { findAll: (fn: (n: unknown) => boolean) => instances.filter(fn) } : null,
  }) as unknown as typeof figma;

describe('rebuild_orphan_buttons handler', () => {
  it('dryRun 只返回计划：只挑主组件缺失的实例，并按填充与高度推断类型与尺寸', async () => {
    const orange = instance({
      id: '1:1',
      label: 'Next',
      height: 48,
      fill: { r: 1, g: 0.59, b: 0.13 },
      mainMissing: true,
    });
    const textOnly = instance({ id: '1:2', label: 'Skip', height: 40, mainMissing: true });
    const healthy = instance({ id: '1:3', label: 'Ok', height: 48, mainMissing: false });

    const result = (await createRebuildOrphanButtonsHandler(ctx([orange, textOnly, healthy]))({
      root: 'root',
      buttonKey: 'btn',
      modeCollections: MODES,
    })) as { dryRun: boolean; found: number; plans: Array<Record<string, unknown>> };

    expect(result.dryRun).toBe(true);
    expect(result.found).toBe(2);
    expect(result.plans[0]).toMatchObject({
      id: '1:1',
      label: 'Next',
      type: 'Primary',
      style: 'Solid',
      size: 'Large',
      state: 'Enabled',
    });
    expect(result.plans[1]).toMatchObject({
      id: '1:2',
      label: 'Skip',
      type: 'Primary',
      style: 'Text',
      size: 'Medium',
    });
  });

  it('白底识别为 Default，红底识别为 Danger', async () => {
    const white = instance({
      id: '2:1',
      label: 'Cancel',
      height: 48,
      fill: { r: 1, g: 1, b: 1 },
      mainMissing: true,
    });
    const red = instance({
      id: '2:2',
      label: 'Delete',
      height: 48,
      fill: { r: 0.85, g: 0.1, b: 0.1 },
      mainMissing: true,
    });
    const result = (await createRebuildOrphanButtonsHandler(ctx([white, red]))({
      root: 'root',
      buttonKey: 'btn',
      modeCollections: MODES,
    })) as { plans: Array<Record<string, unknown>> };

    expect(result.plans.map(p => p.type)).toEqual(['Default', 'Danger']);
  });

  it('嵌在别的实例里的幽灵只计数，不进计划', async () => {
    const outer = { id: 'O', type: 'INSTANCE', parent: { type: 'PAGE' } };
    const nested = instance({
      id: '3:1',
      label: 'Go',
      height: 48,
      mainMissing: true,
      parent: outer,
    });
    const result = (await createRebuildOrphanButtonsHandler(ctx([nested]))({
      root: 'root',
      buttonKey: 'btn',
      modeCollections: MODES,
    })) as { found: number; nestedSkipped: number };

    expect(result.found).toBe(0);
    expect(result.nestedSkipped).toBe(1);
  });

  it('参数不合法时抛错', async () => {
    const handler = createRebuildOrphanButtonsHandler(ctx([]));
    await expect(handler({ buttonKey: 'btn', modeCollections: MODES })).rejects.toThrow(/root/);
    await expect(handler({ root: 'root', modeCollections: MODES })).rejects.toThrow(/buttonKey/);
    await expect(
      handler({ root: 'root', buttonKey: 'btn', modeCollections: { type: 'x' } }),
    ).rejects.toThrow(/modeCollections/);
  });
});

import type { LayoutChange, LayoutJob, LayoutReply } from '@figwright/shared';
import { MaxRectsPacker } from 'maxrects-packer';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

/** 可覆盖的项目名称约定。 */
const configSchema = z.object({
  stageName: z.string().min(1).optional(),
  maskPrefix: z.string().min(1).optional(),
  cropName: z.string().min(1).optional(),
  windowNames: z.array(z.string()).optional(),
  layerNames: z.array(z.string()).optional(),
});

/** 插件内体检，服务端负责聚簇装箱与逐轮调度。 */
export const auditLayoutTool: ToolSpec = {
  name: 'audit_layout',
  kind: 'write',
  injectedArgs: ['changes'],
  description:
    'Audit a page or frame directly inside the plugin without serializing subtrees. Reports CLIP, OVERFLOW, BLANK, SPARSE, AL_BLANK, AL_CLIP, CROP, MASK_SHORT, WIDE_NOTE, TEXT_CLIP and OVERLAP. Skips hidden subtrees and instance/component interiors. Text clipping uses a heuristic and skips mixed font sizes. fix:true repairs innermost issues in rounds, rereads between rounds, and returns clean, remaining issues, errors and rollback (before/after properties, replay before in reverse order). maxPasses bounds convergence; clean:false means unresolved or unreadable nodes. config overrides project name conventions. Intentional crops and overlapping presentation clusters are preserved. Cannot be batched.',
  inputSchema: z.object({
    nodeId: z.string(),
    fix: z.boolean().default(false),
    maxPasses: z.number().int().min(1).max(30).default(8),
    config: configSchema.optional(),
  }),
};

/** 通用容器装箱；默认两遍，hierarchy 按深度由内向外。 */
export const relayoutFramesTool: ToolSpec = {
  name: 'relayout_frames',
  kind: 'write',
  injectedArgs: ['changes', 'containerId'],
  description:
    'Pack visible direct FRAME/COMPONENT/COMPONENT_SET/INSTANCE children using MaxRects (four insertion orders × smart on/off, no rotation). nodeId is a page or frame. mode:hierarchy packs frame containers inside-out up to depth (root depth 0), rereading each level and automatically running twice for stale HUG dimensions. Disables auto layout only on packed containers. Keeps non-box children above the packed area. A category containing itemsName in hierarchy mode is fitted around items using items.x as symmetric margin. Does not enter instances or component definitions. Returns before/after dimensions in rollback, passes and errors; partial writes retain rollback. gap/padding are pixels. Cannot be batched.',
  inputSchema: z.object({
    nodeId: z.string(),
    mode: z.enum(['children', 'hierarchy']).default('children'),
    depth: z.number().int().min(1).max(12).default(4),
    gap: z.number().min(0).max(1000).default(96),
    padding: z.number().min(0).max(1000).default(48),
    itemsName: z.string().min(1).default('items'),
  }),
};

/** 拍平舞台片段；保留空外壳供回退。 */
export const flattenStageTool: ToolSpec = {
  name: 'flatten_stage',
  kind: 'write',
  injectedArgs: ['changes', 'containerId'],
  description:
    'Flatten fragment frames from named shells into stage frames, then MaxRects pack fragments and overview clusters. nodeId is a page or frame. Skips hidden subtrees and component/instance interiors. fix defaults false (preview jobs/changes only). Empty shells are hidden, never deleted, so rollback preserves all shell properties; nonempty shells remain visible and packed. Names are configurable. overviewName and noteName keep the overview mask, coincident component sets and notes together. itemsName is an additional shell name. Returns complete, passes, jobs, changes, rollback and errors. Cannot be batched.',
  inputSchema: z.object({
    nodeId: z.string(),
    fix: z.boolean().default(false),
    stageName: z.string().min(1).default('stage'),
    fragmentPrefix: z.string().min(1).default('片段 · '),
    overviewName: z.string().min(1).default('总览 · 遮住下方叠放的变体'),
    noteName: z.string().min(1).default('提示'),
    itemsName: z.string().min(1).default('items'),
    shellNames: z.array(z.string().min(1)).default(['片段', '片段网格', '高片段列']),
    gap: z.number().min(0).max(1000).default(24),
    padding: z.number().min(0).max(1000).default(0),
  }),
};

/** 搜索四种顺序及 smart 开关，取得分最低的单箱方案。 */
export function packLayout(task: LayoutJob): LayoutChange[] {
  if (!task.boxes.length) return [];
  for (const box of task.boxes)
    if (![box.width, box.height].every(n => Number.isFinite(n) && n > 0))
      throw new Error('装箱尺寸必须为有限正数');
  const orders = [
    (a: (typeof task.boxes)[number], b: typeof a) => b.height - a.height,
    (a: (typeof task.boxes)[number], b: typeof a) => b.width - a.width,
    (a: (typeof task.boxes)[number], b: typeof a) => b.width * b.height - a.width * a.height,
    (a: (typeof task.boxes)[number], b: typeof a) =>
      Math.max(b.width, b.height) - Math.max(a.width, a.height),
  ];
  const min = Math.max(...task.boxes.map(b => b.width));
  const limit = Math.max(
    min,
    Math.min(
      20000,
      task.boxes.reduce((s, b) => s + b.width + task.gap, 0),
    ),
  );
  let best: { score: number; width: number; height: number; positions: LayoutChange[] } | undefined;
  for (const compare of orders)
    for (const smart of [false, true]) {
      const sorted = task.boxes.toSorted(compare);
      for (let width = min; width <= limit; width += 16) {
        const packer = new MaxRectsPacker(
          width,
          Math.max(60000, ...task.boxes.map(b => b.height)),
          task.gap,
          { smart, pot: false, square: false, allowRotation: false },
        );
        for (const box of sorted) packer.add(box.width, box.height, { id: box.id });
        if (packer.bins.length !== 1) continue;
        const rects = packer.bins[0]!.rects;
        const w = Math.max(...rects.map(r => r.x + r.width)),
          h = Math.max(...rects.map(r => r.y + r.height));
        const score = w * h * (1 + 0.6 * Math.abs(Math.log(w / h)));
        if (!best || score < best.score)
          best = {
            score,
            width: w,
            height: h,
            positions: rects.flatMap(r =>
              (task.members[r.data.id as string] ?? []).map(m => ({
                id: m.id,
                x: task.padX + r.x + m.x,
                y: task.padY + r.y + m.y,
              })),
            ),
          };
      }
    }
  if (!best) throw new Error(`容器 ${task.id} 无单箱方案；未写入`);
  if (task.originalArea !== undefined && best.width * best.height >= task.originalArea * 0.97)
    return task.fallback ?? [];
  const minWidth =
    task.originalArea === undefined
      ? Math.max(0, ...(task.fallback ?? []).map(c => c.width ?? 0))
      : 0;
  return [
    ...best.positions,
    {
      id: task.id,
      width: Math.max(minWidth, best.width + task.padX * 2),
      height: best.height + task.padY * 2,
    },
  ];
}

/** 钉住同一插件会话的阶段调度函数。 */
type Dispatch = (tool: string, args: unknown) => Promise<unknown>;

/** 规划、解算、应用与复检；失败时保留已取得的回退记录。 */
export async function handleLayoutTool(
  dispatch: Dispatch,
  tool: 'audit_layout' | 'relayout_frames' | 'flatten_stage',
  args: Record<string, unknown>,
) {
  const rollback: LayoutReply['rollback'] = [],
    errors: LayoutReply['errors'] = [];
  let passes = 0;
  /** 单次插件调用；传输失败也作为部分结果返回。 */
  const call = async (extra: Record<string, unknown> = {}): Promise<LayoutReply | null> => {
    try {
      const reply = (await dispatch(tool, { ...args, ...extra })) as LayoutReply;
      rollback.push(...reply.rollback);
      errors.push(...reply.errors);
      return reply;
    } catch (error) {
      errors.push({ id: String(args.nodeId), message: String(error) });
      return null;
    }
  };
  /** 所有装箱成功后才进入本阶段写入。 */
  const apply = async (reply: LayoutReply): Promise<boolean> => {
    try {
      const changes = [...reply.changes, ...reply.jobs.flatMap(packLayout)];
      if (!changes.length) return false;
      const result = await call({ changes });
      return result !== null && result.rollback.length > 0 && errors.length === 0;
    } catch (error) {
      errors.push({ id: String(args.nodeId), message: String(error) });
      return false;
    }
  };
  let reply = await call();
  const initialIssues = reply?.issues ?? [];
  if (tool === 'flatten_stage') {
    const preview = { jobs: reply?.jobs ?? [], changes: reply?.changes ?? [] };
    if (args.fix && reply && !errors.length) {
      for (const containerId of reply.containers) {
        // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
        const stage = await call({ containerId });
        if (!stage || errors.length) break;
        // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
        await apply(stage);
        if (errors.length) break;
      }
      passes = 1;
    }
    return {
      nodeId: args.nodeId,
      complete: reply !== null && !errors.length,
      passes,
      ...preview,
      rollback,
      errors,
    };
  }
  if (tool === 'audit_layout') {
    if (args.fix)
      for (; passes < Number(args.maxPasses ?? 8) && reply?.issues.length && !errors.length;) {
        passes++;
        // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
        if (!(await apply(reply))) break;
        // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
        reply = await call();
      }
    /** 失败或停滞后也复检，返回剩余问题。 */
    if (args.fix) reply = await call();
    return {
      nodeId: args.nodeId,
      clean: reply !== null && !reply.issues.length && !errors.length,
      initialIssues,
      issues: reply?.issues ?? [],
      passes,
      rollback,
      errors,
    };
  }
  for (; passes < 2 && reply && !errors.length; passes++) {
    for (const containerId of reply.containers) {
      // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
      const stage = await call({ containerId });
      if (!stage || errors.length) break;
      // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
      await apply(stage);
      if (errors.length) break;
    }
    // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
    reply = await call();
  }
  return {
    nodeId: args.nodeId,
    complete: passes === 2 && !errors.length,
    passes,
    rollback,
    errors,
  };
}

import type { LayoutChange, LayoutJob, LayoutReply } from '@figwright/shared';

import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { perfFor } from '../perf.js';
import {
  audit,
  cluster,
  type AuditConfig,
  type AuditNode,
  type AuditTree,
} from './layout-audit.js';

/** 原脚本默认约定；调用方可以覆盖。 */
const DEFAULT_CONFIG: AuditConfig = {
  stageName: 'stage',
  maskPrefix: '总览',
  cropName: '裁切',
  windowNames: ['片段框'],
  layerNames: ['items', '通用', '移动端', '桌面端', '组件', '页面'],
};

/** 插件内部阶段参数；changes 只由服务端注入。 */
interface Params {
  /** 审计或重排根。 */
  nodeId: string;
  /** 名称约定。 */
  config?: Partial<AuditConfig>;
  /** 服务端已解算的修改。 */
  changes?: LayoutChange[];
  /** 本轮目标容器；空值时列出层级。 */
  containerId?: string;
  /** 重排模式。 */
  mode?: 'children' | 'hierarchy';
  /** 最大重排深度。 */
  depth?: number;
  /** 块间距。 */
  gap?: number;
  /** 外边距。 */
  padding?: number;
  /** 类别内 items 容器名称。 */
  itemsName?: string;
  /** 舞台名称。 */
  stageName?: string;
  /** 片段前缀。 */
  fragmentPrefix?: string;
  /** 总览遮罩名称。 */
  overviewName?: string;
  /** 提示名称。 */
  noteName?: string;
  /** 片段外壳名称。 */
  shellNames?: string[];
}

/** 建立不含子树的字段快照；组件定义和实例仅作整体。 */
function snapshot(n: SceneNode): AuditNode {
  const out: AuditNode = {
    id: n.id,
    name: n.name,
    type: n.type,
    parentId: n.parent?.id ?? '',
    visible: n.visible,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
  };
  if ('clipsContent' in n) out.clipsContent = n.clipsContent;
  if ('layoutSizingHorizontal' in n) {
    out.layoutSizingHorizontal = n.layoutSizingHorizontal;
    out.layoutSizingVertical = n.layoutSizingVertical;
  }
  if ('layoutMode' in n)
    out.layout = {
      mode: n.layoutMode,
      paddingLeft: n.paddingLeft,
      paddingRight: n.paddingRight,
      paddingTop: n.paddingTop,
      paddingBottom: n.paddingBottom,
      itemSpacing: n.itemSpacing,
    };
  if (n.type === 'TEXT') {
    out.characters = n.characters;
    out.textAutoResize = n.textAutoResize;
    out.textTruncation = n.textTruncation;
    if (typeof n.fontSize === 'number') out.fontSize = n.fontSize;
    if (typeof n.letterSpacing === 'object') out.letterSpacing = n.letterSpacing;
    if (typeof n.lineHeight === 'object') out.lineHeight = n.lineHeight;
  }
  return out;
}

/** 读取布局树；逐节点容错，跳过隐藏分支及定义内部。 */
async function readTree(api: typeof figma, root: BaseNode, reply: LayoutReply): Promise<AuditTree> {
  const tree: AuditTree = { byId: new Map(), kids: new Map() };
  const queue: BaseNode[] = [root];
  const slice = new TimeSlice(perfFor(api));
  while (queue.length) {
    const n = queue.pop()!;
    try {
      if ('visible' in n && !n.visible) continue;
      if ('x' in n) {
        const s = snapshot(n as SceneNode);
        if ('children' in n && !['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(n.type))
          s.hiddenChildren = n.children.some(child => !child.visible);
        tree.byId.set(s.id, s);
        const siblings = tree.kids.get(s.parentId) ?? [];
        siblings.push(s);
        tree.kids.set(s.parentId, siblings);
      }
      if ('children' in n && !['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(n.type))
        queue.push(...n.children.toReversed());
    } catch (error) {
      reply.errors.push({ id: n.id, message: String(error) });
    }
    if (slice.due()) {
      // oxlint-disable-next-line no-await-in-loop -- 必须串行，让出线程后继续当前遍历。
      await slice.yield();
    }
  }
  return tree;
}

/** 取可见直接子节点。 */
const children = (tree: AuditTree, id: string): AuditNode[] => tree.kids.get(id) ?? [];

/** 内容外框；负坐标也保留给后续修复。 */
function bounds(ks: AuditNode[]) {
  return {
    left: Math.min(...ks.map(k => k.x)),
    top: Math.min(...ks.map(k => k.y)),
    right: Math.max(...ks.map(k => k.x + k.width)),
    bottom: Math.max(...ks.map(k => k.y + k.height)),
  };
}

/** 生成聚簇装箱任务，保留同位叠放。 */
function job(
  id: string,
  groups: AuditNode[][],
  gap: number,
  padX: number,
  padY: number,
): LayoutJob {
  const out: LayoutJob = { id, boxes: [], members: {}, gap, padX, padY };
  for (const [i, group] of groups.entries()) {
    const b = bounds(group),
      key = String(i);
    out.boxes.push({
      id: key,
      width: Math.max(1, Math.ceil(b.right - b.left)),
      height: Math.max(1, Math.ceil(b.bottom - b.top)),
    });
    out.members[key] = group.map(n => ({ id: n.id, x: n.x - b.left, y: n.y - b.top }));
  }
  return out;
}

/** 判断有容差的包含关系。 */
const inside = (a: AuditNode, b: AuditNode): boolean =>
  a.x >= b.x - 4 &&
  a.y >= b.y - 4 &&
  a.x + a.width <= b.x + b.width + 4 &&
  a.y + a.height <= b.y + b.height + 4;

/** 规划最内层问题的修复；每轮重新读取父级尺寸。 */
function planAudit(tree: AuditTree, config: AuditConfig, reply: LayoutReply): void {
  const issues = audit(tree, config);
  reply.issues = issues;
  const bad = new Set(issues.map(i => i.id));
  /** 判断祖先关系，避免递归深树溢栈。 */
  const below = (id: string): boolean => {
    for (const issue of issues) {
      if (issue.id === id) continue;
      for (let n = tree.byId.get(issue.id); n; n = tree.byId.get(n.parentId))
        if (n.parentId === id) return true;
    }
    return false;
  };
  for (const issue of issues.filter(i => bad.has(i.id) && !below(i.id))) {
    const f = tree.byId.get(issue.id)!;
    const ks = children(tree, f.id);
    if (issue.text) {
      reply.changes.push({ id: f.id, textAutoResize: 'HEIGHT' });
      continue;
    }
    if (issue.flags.includes('OVERLAP') && issue.stage) {
      const sorted = ks.map(k => ({ ...k })).toSorted((a, b) => a.y - b.y);

      for (let round = 0; round < sorted.length; round++) {
        let moved = false;
        for (const [i, a] of sorted.entries())
          for (const b of sorted.slice(0, i)) {
            if (
              Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 4 &&
              Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 4 &&
              !inside(a, b) &&
              !inside(b, a)
            ) {
              a.y = Math.ceil(b.y + b.height + 8);
              moved = true;
            }
          }
        if (!moved) break;
      }
      for (const n of sorted)
        if (n.y !== tree.byId.get(n.id)!.y) reply.changes.push({ id: n.id, y: n.y });
      reply.changes.push({
        id: f.id,
        height: Math.max(f.height, Math.ceil(bounds(sorted).bottom)),
      });
      continue;
    }
    if (issue.maskFit) {
      const m = issue.maskFit;
      reply.changes.push(...m.moves, { id: m.mask, width: m.w, height: m.h });
      continue;
    }
    if (issue.flags.includes('CROP') && issue.fit) {
      reply.changes.push({ id: f.id, width: issue.fit[0]!, height: issue.fit[1]! });
      continue;
    }
    if (issue.auto) {
      if (issue.fit) {
        const change: LayoutChange = { id: f.id };
        if (Math.abs(issue.fit[0]! - f.width) > 1) change.layoutSizingHorizontal = 'HUG';
        if (Math.abs(issue.fit[1]! - f.height) > 1) change.layoutSizingVertical = 'HUG';
        reply.changes.push(change);
      }
      if (issue.noteFit)
        for (const id of issue.noteFit.note)
          reply.changes.push({
            id,
            width: Math.max(1, issue.noteFit.width),
            textAutoResize: 'HEIGHT',
          });
      continue;
    }
    const b = bounds(ks),
      mx = Math.min(Math.max(b.left, 0), 48),
      my = Math.min(Math.max(b.top, 0), 48);
    const fallback: LayoutChange[] = [];
    /** 先平移负坐标，再修复左上裁切。 */
    const dx = b.left < 0 ? -b.left : 0,
      dy = b.top < 0 ? -b.top : 0;
    if (dx || dy) for (const n of ks) fallback.push({ id: n.id, x: n.x + dx, y: n.y + dy });
    fallback.push({
      id: f.id,
      width: Math.max(1, Math.ceil(b.right + dx + mx)),
      height: Math.max(1, Math.ceil(b.bottom + dy + my)),
    });
    if (issue.stage && ks.length >= 2) {
      const pack = job(f.id, cluster(ks), 24, mx, my);
      pack.originalArea = (b.right - b.left) * (b.bottom - b.top);
      pack.fallback = fallback;
      reply.jobs.push(pack);
    } else reply.changes.push(...fallback);
  }
}

/** 收集舞台片段，规划改父级与可回退的空壳隐藏。 */
function planFlatten(tree: AuditTree, p: Params, reply: LayoutReply): void {
  const shellNames = new Set([
    ...(p.shellNames ?? ['片段', '片段网格', '高片段列']),
    p.itemsName ?? 'items',
  ]);
  const stages = [...tree.byId.values()].filter(
    n => n.type === 'FRAME' && n.name === (p.stageName ?? 'stage'),
  );
  reply.containers = stages.map(n => n.id).toReversed();
  for (const stage of stages) {
    if (p.containerId && stage.id !== p.containerId) continue;
    const fragments: AuditNode[] = [],
      shells: AuditNode[] = [];
    const top = children(tree, stage.id);
    const queue = top.filter(n => n.type === 'FRAME' && shellNames.has(n.name));
    while (queue.length) {
      const shell = queue.pop()!;
      shells.push(shell);
      for (const child of children(tree, shell.id)) {
        if (child.type !== 'FRAME') continue;
        if (child.name.startsWith(p.fragmentPrefix ?? '片段 · ')) fragments.push(child);
        else if (shellNames.has(child.name)) queue.push(child);
      }
    }
    if (!fragments.length) continue;
    const moved = new Set(fragments.map(n => n.id));
    const empty = new Set<string>();
    for (const shell of shells.toReversed()) {
      /** 隐藏内容也阻止外壳隐藏。 */
      if (
        children(tree, shell.id).every(n => moved.has(n.id) || empty.has(n.id)) &&
        !shell.hiddenChildren
      )
        empty.add(shell.id);
    }
    const rest = top.filter(n => !empty.has(n.id));
    const groups = cluster(rest);
    const named = groups.filter(g =>
      g.some(
        n =>
          n.name === (p.overviewName ?? '总览 · 遮住下方叠放的变体') ||
          n.name === (p.noteName ?? '提示'),
      ),
    );
    const overview = named.flat();
    const packed = [
      ...groups.filter(g => !named.includes(g)),
      ...(overview.length ? [overview] : []),
      ...fragments.map(n => [n]),
    ];
    if (stage.layout?.mode && stage.layout.mode !== 'NONE')
      reply.changes.push({ id: stage.id, layoutMode: 'NONE' });
    reply.changes.push(...fragments.map(n => ({ id: n.id, parentId: stage.id })));
    reply.changes.push(...[...empty].map(id => ({ id, visible: false })));
    reply.jobs.push(job(stage.id, packed, p.gap ?? 24, p.padding ?? 0, p.padding ?? 0));
  }
  if (p.containerId && !reply.containers.includes(p.containerId))
    throw new Error('containerId 不在舞台集合内');
}

/** 读取修改涉及的旧属性，用于回退日志及无变化过滤。 */
function previous(n: SceneNode, change: LayoutChange): LayoutChange {
  const old: LayoutChange = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
  if ('layoutMode' in n) old.layoutMode = n.layoutMode;
  if ('layoutSizingHorizontal' in n) {
    old.layoutSizingHorizontal = n.layoutSizingHorizontal;
    old.layoutSizingVertical = n.layoutSizingVertical;
  }
  if (n.type === 'TEXT') old.textAutoResize = n.textAutoResize;
  if (change.parentId !== undefined || change.childIndex !== undefined) {
    old.parentId = n.parent!.id;
    old.childIndex =
      'children' in n.parent! ? (n.parent.children as readonly BaseNode[]).indexOf(n) : 0;
  }
  for (const key of Object.keys(change) as (keyof LayoutChange)[]) {
    if (key === 'id' || key === 'parentId' || key === 'childIndex') continue;
    if (!(key in n)) throw new Error(`不支持属性 ${key}`);
    Object.assign(old, { [key]: n[key as keyof SceneNode] });
  }
  return old;
}

/** 应用单项修改；字体预加载，resize 后才设文本策略。 */
async function apply(api: typeof figma, n: SceneNode, change: LayoutChange): Promise<void> {
  if (
    n.type === 'TEXT' &&
    (change.width !== undefined ||
      change.height !== undefined ||
      change.textAutoResize !== undefined)
  ) {
    const fonts = n.getRangeAllFontNames(0, n.characters.length);
    if (!fonts.length && n.fontName !== api.mixed) fonts.push(n.fontName);
    await Promise.all(fonts.map(font => api.loadFontAsync(font)));
  }
  if (change.parentId !== undefined) {
    const parent = await api.getNodeByIdAsync(change.parentId);
    if (!parent || (parent.type !== 'FRAME' && parent.type !== 'PAGE'))
      throw new Error('新父级不支持子节点');
    parent.insertChild(change.childIndex ?? parent.children.length, n);
  }
  if (change.visible !== undefined) n.visible = change.visible;
  if (change.layoutMode !== undefined && 'layoutMode' in n) n.layoutMode = change.layoutMode;
  if (change.width !== undefined || change.height !== undefined) {
    if (!('resize' in n)) throw new Error('节点不支持 resize');
    n.resize(change.width ?? n.width, change.height ?? n.height);
  }
  if (change.x !== undefined) n.x = change.x;
  if (change.y !== undefined) n.y = change.y;
  if (change.layoutSizingHorizontal !== undefined && 'layoutSizingHorizontal' in n)
    n.layoutSizingHorizontal = change.layoutSizingHorizontal;
  if (change.layoutSizingVertical !== undefined && 'layoutSizingVertical' in n)
    n.layoutSizingVertical = change.layoutSizingVertical;
  if (change.textAutoResize !== undefined && n.type === 'TEXT')
    n.textAutoResize = change.textAutoResize;
}

/** 创建审计或重排的插件阶段处理器。 */
export const createLayoutToolsHandler =
  (
    api: typeof figma,
    tool: 'audit_layout' | 'relayout_frames' | 'flatten_stage',
  ): SandboxToolHandler =>
  async params => {
    const p = params as Params;
    const reply: LayoutReply = {
      issues: [],
      changes: [],
      jobs: [],
      containers: [],
      rollback: [],
      errors: [],
    };
    const root = await api.getNodeByIdAsync(p.nodeId);
    if (!root || !['PAGE', 'FRAME'].includes(root.type))
      throw new Error(`${tool}: nodeId 必须为页或 frame`);
    for (let n: BaseNode | null = root.parent; n; n = n.parent)
      if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(n.type))
        throw new Error(`${tool}: 不修改实例或组件定义内部`);
    if (root.type === 'PAGE') await root.loadAsync();
    if (p.changes) {
      for (const change of p.changes) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
          const n = await api.getNodeByIdAsync(change.id);
          if (!n || !('x' in n)) throw new Error('节点不存在或不支持布局');
          let inScope = n.id === root.id;
          for (let parent = n.parent; parent; parent = parent.parent) {
            if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(parent.type))
              throw new Error('拒绝修改定义或实例内部');
            if (parent.id === root.id) {
              inScope = true;
              break;
            }
          }
          if (!inScope) throw new Error('节点不在目标子树内');
          if (change.parentId !== undefined) {
            // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
            const target = await api.getNodeByIdAsync(change.parentId);
            if (!target || !['FRAME', 'PAGE'].includes(target.type))
              throw new Error('新父级必须为页或 frame');
            let targetInScope = false;
            for (let parent: BaseNode | null = target; parent; parent = parent.parent) {
              if (parent.id === n.id) throw new Error('不能移入自身子树');
              if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(parent.type))
                throw new Error('拒绝移入定义或实例内部');
              if (parent.id === root.id) {
                targetInScope = true;
                break;
              }
            }
            if (!targetInScope) throw new Error('新父级不在目标子树内');
          }
          const before = previous(n as SceneNode, change);
          if (
            Object.entries(change).every(
              ([key, value]) => before[key as keyof LayoutChange] === value,
            )
          )
            continue;
          /** 写前记旧值，保留部分失败的回退记录。 */
          const record = { before, after: change };
          reply.rollback.push(record);
          try {
            // oxlint-disable-next-line no-await-in-loop -- 必须串行因为后一轮依赖前一轮写回结果。
            await apply(api, n as SceneNode, change);
          } finally {
            record.after = previous(n as SceneNode, change);
          }
        } catch (error) {
          reply.errors.push({ id: change.id, message: String(error) });
          break;
        }
      }
      return reply;
    }
    const tree = await readTree(api, root, reply);
    if (tool === 'audit_layout') {
      planAudit(tree, { ...DEFAULT_CONFIG, ...p.config }, reply);
      return reply;
    }
    if (tool === 'flatten_stage') {
      planFlatten(tree, p, reply);
      return reply;
    }
    const boxes = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);
    /** 层级遍历深度，类别含 items 时只收紧类别外框。 */
    const queue = [{ id: root.id, depth: 0 }];
    while (queue.length) {
      const current = queue.pop()!;
      if (current.depth >= (p.mode === 'hierarchy' ? (p.depth ?? 4) : 1)) continue;
      const ks = children(tree, current.id);
      if (ks.some(k => boxes.has(k.type))) reply.containers.unshift(current.id);
      for (const n of ks)
        if (n.type === 'FRAME') queue.push({ id: n.id, depth: current.depth + 1 });
    }
    if (!p.containerId) return reply;
    if (!reply.containers.includes(p.containerId))
      throw new Error('containerId 不在本次重排层级中');
    const f = tree.byId.get(p.containerId),
      ks = children(tree, p.containerId);
    const items = ks.find(k => k.name === (p.itemsName ?? 'items') && k.type === 'FRAME');
    if (items && p.mode === 'hierarchy') {
      const pad = Math.max(0, items.x),
        b = bounds(ks);
      if (f?.layout && f.layout.mode !== 'NONE')
        reply.changes.push({ id: f.id, layoutMode: 'NONE' });
      reply.changes.push({
        id: p.containerId,
        width: Math.max(
          1,
          Math.ceil(
            Math.max(
              items.x + items.width + pad,
              ...ks.filter(k => k !== items).map(k => k.x + k.width),
            ),
          ),
        ),
        height: Math.max(1, Math.ceil(Math.max(items.y + items.height + pad, b.bottom))),
      });
      return reply;
    }
    const selected = ks.filter(k => boxes.has(k.type));
    if (p.mode === 'hierarchy')
      for (const child of selected) {
        const content = children(tree, child.id);
        if (
          child.type !== 'FRAME' ||
          (child.layout?.mode && child.layout.mode !== 'NONE') ||
          !content.length
        )
          continue;
        const b = bounds(content);
        if (b.left < 0 || b.top < 0) continue;
        const width = Math.max(1, Math.min(child.width, Math.ceil(b.right + b.left)));
        const height = Math.max(1, Math.min(child.height, Math.ceil(b.bottom + b.top)));
        if (width < child.width - 1 || height < child.height - 1) {
          reply.changes.push({ id: child.id, width, height });
          child.width = width;
          child.height = height;
        }
      }
    const others = ks.filter(k => !boxes.has(k.type));
    const pad = p.padding ?? 48;
    const top = others.length ? Math.max(pad, bounds(others).bottom + pad) : pad;
    const task = job(
      p.containerId,
      selected.map(k => [k]),
      p.gap ?? 96,
      pad,
      top,
    );
    /** 容器仍需包含未装箱的标题。 */
    task.fallback = others.length
      ? [{ id: p.containerId, width: Math.max(1, Math.ceil(bounds(others).right + pad)) }]
      : [];
    if (f?.layout && f.layout.mode !== 'NONE') reply.changes.push({ id: f.id, layoutMode: 'NONE' });
    reply.jobs.push(task);
    return reply;
  };

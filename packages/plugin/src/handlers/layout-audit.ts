/** 插件内审计快照：只读检测所需字段。 */
export interface AuditNode {
  /** 节点标识。 */
  id: string;
  /** 节点名称。 */
  name: string;
  /** 节点类型。 */
  type: string;
  /** 父节点标识。 */
  parentId: string;
  /** 横坐标。 */
  x: number;
  /** 纵坐标。 */
  y: number;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 是否可见。 */
  visible: boolean;
  /** 是否含隐藏子节点。 */
  hiddenChildren?: boolean;
  /** 是否裁剪。 */
  clipsContent?: boolean;
  /** 自动布局所需字段。 */
  layout?: {
    mode: string;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
    itemSpacing: number;
  };
  /** 水平尺寸策略；缺失按固定处理。 */
  layoutSizingHorizontal?: string;
  /** 垂直尺寸策略。 */
  layoutSizingVertical?: string;
  /** 文字尺寸策略。 */
  textAutoResize?: string;
  /** 截断策略。 */
  textTruncation?: string;
  /** 字号；混合字号不估算。 */
  fontSize?: number;
  /** 字距。 */
  letterSpacing?: { unit: string; value: number };
  /** 行高。 */
  lineHeight?: { unit: string; value?: number };
  /** 文字内容。 */
  characters?: string;
}
/** 审计树索引。 */
export interface AuditTree {
  /** 标识索引。 */
  byId: Map<string, AuditNode>;
  /** 直接子节点索引。 */
  kids: Map<string, AuditNode[]>;
}
/** 名字约定，可按项目覆盖。 */
export interface AuditConfig {
  /** 舞台名称。 */
  stageName: string;
  /** 遮罩名称前缀。 */
  maskPrefix: string;
  /** 裁切窗口名称。 */
  cropName: string;
  /** 有意裁切的窗口名称。 */
  windowNames: string[];
  /** 由重排工具处理的外层容器名。 */
  layerNames: string[];
}
/** 原脚本的容差与稀疏阈值。 */
const NOTE_TOL = 48,
  OVER_TOL = 1,
  BLANK_TOL = 24,
  SPARSE_FILL = 0.55,
  SPARSE_MIN_AREA = 120000,
  CELL = 8,
  NEAR = 10;
/** 是否在组件定义内部（祖先里有 COMPONENT / COMPONENT_SET）。 */
function inDefinition(n: AuditNode, byId: Map<string, AuditNode>) {
  for (let p = byId.get(n.parentId); p; p = byId.get(p.parentId))
    if (p.type === 'COMPONENT' || p.type === 'COMPONENT_SET') return true;
  return false;
}

/** 子节点并集覆盖率（栅格近似）。 */
function coverage(F: AuditNode, ks: AuditNode[]) {
  const cell = Math.max(CELL, Math.sqrt((F.width * F.height) / 1000000));
  const cw = Math.max(1, Math.ceil(F.width / cell)),
    ch = Math.max(1, Math.ceil(F.height / cell));
  const g = new Uint8Array(cw * ch);
  for (const k of ks) {
    const x0 = Math.max(0, Math.floor(k.x / cell)),
      y0 = Math.max(0, Math.floor(k.y / cell));
    const x1 = Math.min(cw, Math.ceil((k.x + k.width) / cell)),
      y1 = Math.min(ch, Math.ceil((k.y + k.height) / cell));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * cw + x] = 1;
  }
  let c = 0;
  for (const v of g) c += v;
  return c / (cw * ch);
}

/** 节点的固有宽度：固定宽度的取自身宽度；自动布局里「填满」或「包裹」的递归看内容，文字取当前宽度（单行文字的固有宽度就是自身）。 */
function intrinsicW(n: AuditNode, kids: Map<string, AuditNode[]>): number {
  const ks = (kids.get(n.id) || []).filter(k => k.visible !== false);
  const mode = n.layout && n.layout.mode && n.layout.mode !== 'NONE' ? n.layout.mode : null;
  if (n.type !== 'FRAME' || !mode || !ks.length) return n.width;
  const pad = (n.layout!.paddingLeft || 0) + (n.layout!.paddingRight || 0),
    gap = n.layout!.itemSpacing || 0;
  const iw = ks.map(k =>
    k.layoutSizingHorizontal === 'FILL' || k.type === 'FRAME' ? intrinsicW(k, kids) : k.width,
  );
  if (mode === 'HORIZONTAL')
    return Math.ceil(iw.reduce((a, b) => a + b, 0) + gap * (ks.length - 1) + pad);
  if (mode === 'VERTICAL') return Math.ceil(Math.max(...iw) + pad);
  return n.width;
}

/** 兄弟部分重叠的对：交叠面积大于 0，且既不是一个完全包含另一个，也不是（近乎）同位叠放。 */
function overlapPairs(ks: AuditNode[]) {
  const out = [],
    T = 4;
  for (let i = 0; i < ks.length; i++)
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i]!,
        b = ks[j]!;
      const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ix <= T || iy <= T) continue;
      const inside = (p: AuditNode, q: AuditNode) =>
        p.x >= q.x - T &&
        p.y >= q.y - T &&
        p.x + p.width <= q.x + q.width + T &&
        p.y + p.height <= q.y + q.height + T;
      if (inside(a, b) || inside(b, a)) continue;
      out.push([a.name, b.name, Math.round(ix), Math.round(iy), a.id, b.id]);
    }
  return out;
}

/** 遮罩（名字以「总览」开头的 frame）与同一原点的变体集：遮罩小于变体集时返回修复方案 { mask, w, h, moves }。 */
function maskShort(ks: AuditNode[], config: AuditConfig) {
  const T = 4;
  for (const S of ks.filter(k => k.type === 'COMPONENT_SET')) {
    const M = ks.find(
      k =>
        k.type === 'FRAME' &&
        k.name.startsWith(config.maskPrefix) &&
        Math.abs(k.x - S.x) <= T &&
        Math.abs(k.y - S.y) <= T,
    );
    if (!M) continue;
    const w = Math.max(M.width, Math.ceil(S.width)),
      h = Math.max(M.height, Math.ceil(S.height));
    if (w - M.width <= T && h - M.height <= T) continue;
    const dw = w - M.width,
      dh = h - M.height,
      moves = [];
    for (const k of ks) {
      if (k.id === M.id || k.id === S.id) continue;
      const belowM = k.y >= M.y + M.height - T && k.x < M.x + w && k.x + k.width > M.x;
      const rightM =
        dw > T && k.x >= M.x + M.width - T && k.y < M.y + M.height && k.y + k.height > M.y;
      if (belowM && dh > T) moves.push({ id: k.id, x: k.x, y: k.y + dh });
      else if (rightM) moves.push({ id: k.id, x: k.x + dw, y: k.y });
    }
    return { mask: M.id, from: [M.width, M.height], w, h, moves };
  }
  return null;
}

/** 估算文字需要的行数：CJK 按一个字号宽，其余按 0.56 字号宽，加字间距。只用来判断「装不下」，不求精确。 */
function estLines(t: AuditNode) {
  const fs = t.fontSize || 12,
    ls = (t.letterSpacing && t.letterSpacing.unit === 'PIXELS' ? t.letterSpacing.value : 0) || 0;
  let total = 0;
  for (const ch of t.characters || '') total += (/[⺀-鿿＀-￯]/.test(ch) ? fs : fs * 0.56) + ls;
  const lines = String(t.characters || '').split('\n').length;
  return Math.max(lines, Math.ceil(total / Math.max(t.width, 1)));
}

/** 舞台类 frame：名叫 stage，或直接含组件 / 组件集。 */
const stageLike = (F: AuditNode, ks: AuditNode[], config: AuditConfig) =>
  F.name === config.stageName || ks.some(k => k.type === 'COMPONENT_SET' || k.type === 'COMPONENT');

/** 体检：返回问题列表 [{ id, name, flags, waste, ... }]。 */
export function audit({ byId, kids }: AuditTree, config: AuditConfig) {
  const out = [];
  for (const F of byId.values()) {
    if (F.type !== 'FRAME' || F.visible === false) continue;
    if (inDefinition(F, byId)) continue;
    const ks = (kids.get(F.id) || []).filter(k => k.visible !== false);
    if (!ks.length) continue;
    const mode = F.layout && F.layout.mode && F.layout.mode !== 'NONE' ? F.layout.mode : null;
    const W = F.width,
      H = F.height;
    const maxR = Math.max(...ks.map(k => k.x + k.width)),
      maxB = Math.max(...ks.map(k => k.y + k.height));
    const minX = Math.min(...ks.map(k => k.x)),
      minY = Math.min(...ks.map(k => k.y));
    const flags = [];
    let waste = 0,
      fit = null,
      noteFit = null,
      overlap = null,
      maskFit = null,
      overlapAll = null;
    if (!mode) {
      const mk = maskShort(ks, config);
      if (mk) {
        flags.push('MASK_SHORT');
        waste = Math.max(waste, 1);
        maskFit = mk;
      }
      const ov = overlapPairs(ks);
      if (ov.length) {
        flags.push('OVERLAP');
        waste = Math.max(waste, 1);
        overlap = ov.slice(0, 6);
        overlapAll = ov;
      }
      const over = ks.some(
        k =>
          k.x < -OVER_TOL ||
          k.y < -OVER_TOL ||
          k.x + k.width > W + OVER_TOL ||
          k.y + k.height > H + OVER_TOL,
      );
      const fromOrigin = ks.every(k => k.x >= -OVER_TOL && k.y >= -OVER_TOL);
      if (over && F.name === config.cropName && fromOrigin) {
        flags.push('CROP');
        fit = [Math.ceil(maxR), Math.ceil(maxB)];
        waste = 1;
      } else if (
        over &&
        !(F.clipsContent && (config.windowNames.includes(F.name) || F.name === config.cropName))
      )
        flags.push(F.clipsContent ? 'CLIP' : 'OVERFLOW');
      /** 总览盖板跳过留白检测，避免与遮罩扩张冲突。 */
      if (!config.layerNames.includes(F.name) && !F.name.startsWith(config.maskPrefix)) {
        const wx = W - maxR - Math.max(minX, 0),
          wy = H - maxB - Math.max(minY, 0);
        if (wx > BLANK_TOL || wy > BLANK_TOL) {
          flags.push('BLANK');
          waste = Math.max(wx, 0) * H + Math.max(wy, 0) * W;
        }
        if (ks.length >= 2 && W * H > SPARSE_MIN_AREA && stageLike(F, ks, config)) {
          const fill = coverage(F, ks);
          if (fill < SPARSE_FILL) {
            flags.push('SPARSE');
            waste = Math.max(waste, W * H * (1 - fill));
          }
        }
      }
    } else if (!config.layerNames.includes(F.name)) {
      /** 仅检测固定方向的内容留白。 */
      const l = F.layout!,
        fixedX = !['HUG', 'FILL'].includes(F.layoutSizingHorizontal ?? 'FIXED'),
        fixedY = !['HUG', 'FILL'].includes(F.layoutSizingVertical ?? 'FIXED');
      const needW = Math.min(Math.ceil(maxR + (l.paddingRight || 0)), intrinsicW(F, kids)),
        needH = Math.ceil(maxB + (l.paddingBottom || 0));
      const wx = fixedX ? W - needW : 0,
        wy = fixedY ? H - needH : 0;
      if (wx > BLANK_TOL || wy > BLANK_TOL) {
        flags.push('AL_BLANK');
        waste = Math.max(wx, 0) * H + Math.max(wy, 0) * W;
        fit = [wx > BLANK_TOL ? needW : Math.round(W), wy > BLANK_TOL ? needH : Math.round(H)];
      }
      const rawW = Math.ceil(maxR + (l.paddingRight || 0)),
        rawH = Math.ceil(maxB + (l.paddingBottom || 0));
      if (
        !flags.includes('AL_BLANK') &&
        ((fixedX && rawW > W + OVER_TOL) || (fixedY && rawH > H + OVER_TOL))
      ) {
        flags.push('AL_CLIP');
        waste = 1;
        fit = [
          fixedX && rawW > W + OVER_TOL ? rawW : Math.round(W),
          fixedY && rawH > H + OVER_TOL ? rawH : Math.round(H),
        ];
      }
      if (mode === 'VERTICAL') {
        const texts = ks.filter(k => k.type === 'TEXT'),
          others = ks.filter(k => k.type !== 'TEXT');
        if (others.length && texts.length) {
          const base = Math.max(...others.map(k => intrinsicW(k, kids)));
          const wide = texts.filter(t => t.width > base + NOTE_TOL);
          if (wide.length) {
            flags.push('WIDE_NOTE');
            waste = Math.max(waste, (Math.max(...wide.map(t => t.width)) - base) * H);
            noteFit = { note: wide.map(t => t.id), width: Math.ceil(base) };
          }
        }
      }
    }
    if (flags.length)
      out.push({
        id: F.id,
        name: F.name,
        parent: byId.get(F.parentId)?.name,
        size: [Math.round(W), Math.round(H)],
        flags,
        waste: Math.round(waste),
        stage: !mode && stageLike(F, ks, config),
        auto: !!mode,
        fit,
        noteFit,
        overlap,
        maskFit,
        overlapAll,
      });
  }
  /** 估算固定且未截断文字的高度缺口。 */
  for (const T of byId.values()) {
    if (
      T.fontSize === undefined ||
      T.type !== 'TEXT' ||
      T.visible === false ||
      T.textAutoResize !== 'NONE' ||
      T.textTruncation === 'ENDING'
    )
      continue;
    if (inDefinition(T, byId)) continue;
    const lh =
      T.lineHeight && T.lineHeight.unit === 'PIXELS'
        ? (T.lineHeight.value ?? T.fontSize * 1.3)
        : (T.fontSize || 12) * 1.3;
    const need = estLines(T) * lh;
    if (need > T.height + 4 && estLines(T) > 1)
      out.push({
        id: T.id,
        name: (T.characters || '').slice(0, 24),
        parent: byId.get(T.parentId)?.name,
        size: [Math.round(T.width), Math.round(T.height)],
        flags: ['TEXT_CLIP'],
        waste: 1,
        text: true,
      });
  }
  return out.toSorted((a, b) => b.waste - a.waste);
}

/** 并查集聚簇：两个子节点矩形外扩 NEAR 后相交即同簇。 */
export function cluster(ks: AuditNode[]) {
  const p = ks.map((_, i) => i);
  const find = (i: number): number => (p[i] === i ? i : (p[i] = find(p[i]!)));
  for (let i = 0; i < ks.length; i++)
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i]!,
        b = ks[j]!;
      if (
        a.x < b.x + b.width + NEAR &&
        b.x < a.x + a.width + NEAR &&
        a.y < b.y + b.height + NEAR &&
        b.y < a.y + a.height + NEAR
      )
        p[find(i)] = find(j);
    }
  const m = new Map<number, AuditNode[]>();
  ks.forEach((k, i) => {
    const r = find(i);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(k);
  });
  return [...m.values()];
}

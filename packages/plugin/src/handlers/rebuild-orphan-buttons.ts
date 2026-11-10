import type { SandboxToolHandler } from '../dispatcher.js';

type ModeKeys = { type: string; style: string; size: string; state: string };

type Params = {
  root?: unknown;
  buttonKey?: unknown;
  modeCollections?: unknown;
  labelLayerName?: unknown;
  dryRun?: unknown;
};

type Plan = {
  id: string;
  parentId: string;
  label: string;
  width: number;
  height: number;
  type: string;
  style: string;
  size: string;
  state: string;
};

/** 在库集合里取第一个变量并导入，借它拿到远程集合对象（Figma 只通过变量发放远程集合）。 */
const resolveLibraryCollection = async (
  figmaCtx: typeof figma,
  key: string,
): Promise<VariableCollection | null> => {
  const api = figmaCtx.teamLibrary;
  if (api === undefined) return null;
  const all = await api.getAvailableLibraryVariableCollectionsAsync();
  const found = all.find(c => c.key === key || `VariableCollectionId:${c.key}` === key);
  if (found === undefined) return null;
  const vars = await api.getVariablesInLibraryCollectionAsync(found.key);
  const first = vars[0];
  if (first === undefined) return null;
  const imported = await figmaCtx.variables.importVariableByKeyAsync(first.key);
  return figmaCtx.variables.getVariableCollectionByIdAsync(imported.variableCollectionId);
};

const isModeKeys = (v: unknown): v is ModeKeys => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return ['type', 'style', 'size', 'state'].every(k => typeof o[k] === 'string');
};

/** 按高度推断库 Button 的尺寸模式。 */
const sizeOf = (h: number): string => {
  if (h >= 56) return 'XLarge';
  if (h >= 48) return 'Large';
  if (h >= 40) return 'Medium';
  if (h >= 32) return 'Small';
  return 'Mini';
};

/** 按填充色推断类型与样式：橙 Primary、红 Danger、白 Default；无填充视为文字按钮（Text）。 */
const kindOf = (node: SceneNode, textColor: RGB | null): { type: string; style: string } => {
  const fills = 'fills' in node && Array.isArray(node.fills) ? (node.fills as Paint[]) : [];
  const solid = fills.find(f => f.type === 'SOLID' && f.visible !== false) as
    | SolidPaint
    | undefined;
  if (solid === undefined) {
    const c = textColor;
    if (c !== null && c.r > 0.7 && c.g < 0.35) return { type: 'Danger', style: 'Text' };
    return { type: 'Primary', style: 'Text' };
  }
  const { r, g, b } = solid.color;
  if (r > 0.93 && g > 0.93 && b > 0.93) return { type: 'Default', style: 'Solid' };
  if (r > 0.7 && g < 0.35 && b < 0.35) return { type: 'Danger', style: 'Solid' };
  return { type: 'Primary', style: 'Solid' };
};

/**
 * 重建「主组件已丢失」的按钮实例。删除组件库页后，指向被删主组件的实例会变成读不出属性的幽灵节点， 只剩缓存画面（文字永远是默认值）。这里找出 root 子树里主组件为空、且带可见文字层的实例，
 * 读出文字、尺寸、配色，用库 Button 在同一父级同一位置重建，设好 Label 和四个模式后删掉幽灵节点。 嵌在其他实例里的幽灵节点不能单独改，只计数；要先修它所在的组件定义。dryRun
 * 默认开，只返回计划。
 */
export const createRebuildOrphanButtonsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as Params;
    if (typeof p.root !== 'string')
      throw new TypeError('rebuild_orphan_buttons: root must be a string');
    if (typeof p.buttonKey !== 'string') {
      throw new TypeError('rebuild_orphan_buttons: buttonKey must be a published component key');
    }
    if (!isModeKeys(p.modeCollections)) {
      throw new TypeError(
        'rebuild_orphan_buttons: modeCollections needs type, style, size, state collection keys',
      );
    }
    const labelLayer = typeof p.labelLayerName === 'string' ? p.labelLayerName : 'Button';
    const dryRun = p.dryRun !== false;

    const root = await figmaCtx.getNodeByIdAsync(p.root);
    if (root === null || !('findAll' in root)) {
      throw new Error(`rebuild_orphan_buttons: node ${p.root} not found or has no children`);
    }

    const plans: Array<{ node: InstanceNode; plan: Plan }> = [];
    let nested = 0;
    let scanned = 0;
    for (const n of root.findAll(x => x.type === 'INSTANCE') as InstanceNode[]) {
      scanned++;
      let main: ComponentNode | null = null;
      try {
        main = await n.getMainComponentAsync();
      } catch {
        main = null;
      }
      if (main !== null) continue;
      const text = n.findOne(
        x => x.type === 'TEXT' && x.name === labelLayer && x.visible,
      ) as TextNode | null;
      if (text === null) continue;
      let up: BaseNode | null = n.parent;
      let isNested = false;
      while (up !== null && up.type !== 'PAGE') {
        if (up.type === 'INSTANCE') {
          isNested = true;
          break;
        }
        up = up.parent;
      }
      if (isNested) {
        nested++;
        continue;
      }
      const fillsOfText = Array.isArray(text.fills) ? (text.fills as Paint[]) : [];
      const tf = fillsOfText.find(f => f.type === 'SOLID') as SolidPaint | undefined;
      const { type, style } = kindOf(n, tf === undefined ? null : tf.color);
      plans.push({
        node: n,
        plan: {
          id: n.id,
          parentId: n.parent?.id ?? '',
          label: text.characters,
          width: n.width,
          height: n.height,
          type,
          style,
          size: sizeOf(n.height),
          state: n.opacity < 0.6 ? 'Disabled' : 'Enabled',
        },
      });
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        scanned,
        nestedSkipped: nested,
        found: plans.length,
        plans: plans.slice(0, 200).map(x => x.plan),
      };
    }

    const lib = await figmaCtx.importComponentByKeyAsync(p.buttonKey);
    const cols: Record<keyof ModeKeys, VariableCollection | null> = {
      type: await resolveLibraryCollection(figmaCtx, p.modeCollections.type),
      style: await resolveLibraryCollection(figmaCtx, p.modeCollections.style),
      size: await resolveLibraryCollection(figmaCtx, p.modeCollections.size),
      state: await resolveLibraryCollection(figmaCtx, p.modeCollections.state),
    };
    const modeId = (c: VariableCollection | null, name: string): string | null =>
      c?.modes.find(m => m.name === name)?.modeId ?? null;

    let rebuilt = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const { node, plan } of plans) {
      try {
        const parent = node.parent;
        if (parent === null || !('insertChild' in parent)) throw new Error('no container parent');
        const index = parent.children.indexOf(node);
        const sizingH = 'layoutSizingHorizontal' in node ? node.layoutSizingHorizontal : undefined;
        const sizingV = 'layoutSizingVertical' in node ? node.layoutSizingVertical : undefined;
        const inst = lib.createInstance();
        parent.insertChild(index, inst);
        inst.name = node.name;
        const labelKey = Object.keys(inst.componentProperties).find(k => k.startsWith('Label#'));
        if (labelKey !== undefined) inst.setProperties({ [labelKey]: plan.label });
        for (const k of ['type', 'style', 'size', 'state'] as const) {
          const c = cols[k];
          const m = modeId(c, plan[k]);
          if (c !== null && m !== null) inst.setExplicitVariableModeForCollection(c, m);
        }
        if (sizingH === 'FILL') inst.layoutSizingHorizontal = 'FILL';
        if (sizingV === 'FILL') inst.layoutSizingVertical = 'FILL';
        node.remove();
        rebuilt++;
      } catch (e) {
        failed.push({ id: plan.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ok: true, dryRun: false, scanned, nestedSkipped: nested, rebuilt, failed };
  };

import { describe, expect, it, vi } from 'vitest';

import {
  audit,
  type AuditConfig,
  type AuditNode,
  type AuditTree,
} from '../../src/handlers/layout-audit.js';
import { createLayoutToolsHandler } from '../../src/handlers/layout-tools.js';

/** 默认测试名称约定。 */
const config: AuditConfig = {
  stageName: 'stage',
  maskPrefix: '总览',
  cropName: '裁切',
  windowNames: ['片段框'],
  layerNames: ['items'],
};
/** 创建审计字段，不引入序列化。 */
const node = (id: string, fields: Partial<AuditNode> = {}): AuditNode => ({
  id,
  name: id,
  type: 'FRAME',
  parentId: 'page',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  visible: true,
  ...fields,
});
/** 构建扁平节点索引。 */
function tree(nodes: AuditNode[]): AuditTree {
  const kids = new Map<string, AuditNode[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  return { byId: new Map(nodes.map(n => [n.id, n])), kids };
}
/** 自动布局尺寸字段。 */
const layout = {
  mode: 'VERTICAL',
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
  itemSpacing: 0,
};

describe('layout audit rules', () => {
  it.each([
    ['CLIP', true],
    ['OVERFLOW', false],
  ] as const)('detects %s including negative origins', (flag, clipsContent) => {
    const result = audit(
      tree([node('f', { clipsContent }), node('c', { parentId: 'f', x: -10, width: 120 })]),
      config,
    );
    expect(result[0]?.flags).toContain(flag);
  });

  it('detects BLANK and SPARSE but excludes intentional overview masks', () => {
    const nodes = [
      node('f', { name: 'stage', width: 1000, height: 1000 }),
      node('a', { parentId: 'f' }),
      node('b', { parentId: 'f', x: 800, y: 800 }),
    ];
    expect(audit(tree(nodes), config)[0]?.flags).toEqual(
      expect.arrayContaining(['BLANK', 'SPARSE']),
    );
    nodes[0]!.name = '总览 · intentional';
    expect(audit(tree(nodes), config)).toEqual([]);
  });

  it.each([
    ['AL_BLANK', 200, 100],
    ['AL_CLIP', 100, 200],
  ] as const)('treats missing layoutSizing as FIXED for %s', (flag, width, childWidth) => {
    const result = audit(
      tree([
        node('f', { layout, width, height: 100 }),
        node('a', { type: 'INSTANCE', parentId: 'f', width: childWidth }),
      ]),
      config,
    );
    expect(result[0]?.flags).toContain(flag);
  });

  it('does not report HUG/FILL dimensions as fixed blank', () => {
    expect(
      audit(
        tree([
          node('f', {
            layout,
            width: 300,
            height: 300,
            layoutSizingHorizontal: 'HUG',
            layoutSizingVertical: 'FILL',
          }),
          node('a', { parentId: 'f', type: 'INSTANCE' }),
        ]),
        config,
      ),
    ).toEqual([]);
  });

  it('distinguishes origin crop from intentional negative offset crop', () => {
    const f = node('f', { name: '裁切', clipsContent: true });
    expect(
      audit(tree([f, node('a', { parentId: 'f', type: 'INSTANCE', width: 200 })]), config)[0]
        ?.flags,
    ).toContain('CROP');
    expect(
      audit(tree([f, node('a', { parentId: 'f', type: 'INSTANCE', width: 200, x: -100 })]), config),
    ).toEqual([]);
  });

  it('grows a short overview mask and moves the note out of its way', () => {
    const result = audit(
      tree([
        node('f', { name: 'stage', width: 250, height: 250 }),
        node('set', { type: 'COMPONENT_SET', parentId: 'f', width: 200, height: 200 }),
        node('mask', { name: '总览', parentId: 'f' }),
        node('note', { type: 'TEXT', parentId: 'f', y: 100, height: 20 }),
      ]),
      config,
    );
    expect(result.find(i => i.id === 'f')?.maskFit).toMatchObject({
      mask: 'mask',
      w: 200,
      h: 200,
      moves: [{ id: 'note', x: 0, y: 200 }],
    });
  });

  it('detects WIDE_NOTE, TEXT_CLIP and partial OVERLAP while preserving containment', () => {
    const result = audit(
      tree([
        node('f', { layout, width: 300, height: 200 }),
        node('a', { parentId: 'f', type: 'INSTANCE' }),
        node('note', {
          type: 'TEXT',
          parentId: 'f',
          width: 300,
          height: 10,
          y: 100,
          textAutoResize: 'NONE',
          fontSize: 12,
          characters: '中'.repeat(60),
        }),
        node('stage', { name: 'stage', width: 300, height: 150 }),
        node('b', { parentId: 'stage' }),
        node('c', { parentId: 'stage', x: 80, y: 50 }),
      ]),
      config,
    );
    expect(result.find(i => i.id === 'f')?.flags).toContain('WIDE_NOTE');
    expect(result.find(i => i.id === 'note')?.flags).toEqual(['TEXT_CLIP']);
    expect(result.find(i => i.id === 'stage')?.flags).toContain('OVERLAP');
    expect(
      audit(
        tree([
          node('f'),
          node('a', { parentId: 'f' }),
          node('b', { parentId: 'f', width: 50, height: 50 }),
        ]),
        config,
      ),
    ).toEqual([]);
  });

  it('does not guess mixed-font text or truncated text', () => {
    const fields = {
      type: 'TEXT',
      textAutoResize: 'NONE',
      characters: '中'.repeat(100),
      height: 10,
    };
    expect(
      audit(
        tree([
          node('mixed', fields),
          node('truncated', { ...fields, fontSize: 12, textTruncation: 'ENDING' }),
        ]),
        config,
      ),
    ).toEqual([]);
  });
});

/** 原生节点最小替身，模拟 resize 对文字策略的副作用。 */
function fixture() {
  const page = {
    id: 'page',
    type: 'PAGE',
    parent: null,
    children: [] as unknown[],
    loadAsync: vi.fn<() => Promise<void>>(async () => {}),
  };
  const f = {
    ...node('f'),
    parent: page,
    children: [] as unknown[],
    resize: vi.fn<(w: number, h: number) => void>(function (
      this: { width: number; height: number },
      w: number,
      h: number,
    ) {
      this.width = w;
      this.height = h;
    }),
  };
  page.children.push(f);
  const nodes = new Map<string, unknown>([
    ['page', page],
    ['f', f],
  ]);
  const api = {
    mixed: Symbol('mixed'),
    getNodeByIdAsync: vi.fn<(id: string) => Promise<unknown>>(async id => nodes.get(id) ?? null),
    loadFontAsync: vi.fn<() => Promise<void>>(async () => {}),
  } as unknown as typeof figma;
  return { page, f, nodes, api };
}

describe('layout plugin phases', () => {
  it('loads pages, skips instance interiors and reports per-node getter failures', async () => {
    const f = fixture();
    const broken = {
      id: 'bad',
      visible: true,
      get x() {
        throw new Error('invalid id');
      },
    };
    const instance = {
      ...node('instance', { type: 'INSTANCE', parentId: 'f' }),
      parent: f.f,
      get children() {
        throw new Error('must not read');
      },
    };
    f.f.children.push(broken, instance);
    const result = await createLayoutToolsHandler(f.api, 'audit_layout')({ nodeId: 'page' });
    expect(f.page.loadAsync).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      errors: [{ id: 'bad', message: expect.stringContaining('invalid id') }],
    });
  });

  it('plans HUG for elastic grids instead of resizing', async () => {
    const f = fixture();
    Object.assign(f.f, {
      layoutMode: 'GRID',
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      itemSpacing: 0,
      width: 300,
    });
    f.f.children.push({ ...node('a', { parentId: 'f', type: 'INSTANCE' }), parent: f.f });
    expect(await createLayoutToolsHandler(f.api, 'audit_layout')({ nodeId: 'f' })).toMatchObject({
      changes: [{ id: 'f', layoutSizingHorizontal: 'HUG' }],
    });
    expect(f.f.resize).not.toHaveBeenCalled();
  });

  it('loads fonts and sets HEIGHT after resize; logs old and actual final dimensions', async () => {
    const f = fixture();
    const text = {
      ...node('text', { type: 'TEXT', parentId: 'f' }),
      parent: f.f,
      characters: 'hello',
      fontName: { family: 'Inter', style: 'Regular' },
      textAutoResize: 'NONE',
      getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
        this.textAutoResize = 'NONE';
      },
    };
    f.nodes.set('text', text);
    f.f.children.push(text);
    const result = await createLayoutToolsHandler(
      f.api,
      'audit_layout',
    )({ nodeId: 'f', changes: [{ id: 'text', width: 60, textAutoResize: 'HEIGHT' }] });
    expect(text.textAutoResize).toBe('HEIGHT');
    expect(text.width).toBe(60);
    expect(f.api.loadFontAsync).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      rollback: [
        {
          before: { width: 100, textAutoResize: 'NONE' },
          after: { width: 60, textAutoResize: 'HEIGHT' },
        },
      ],
    });
  });

  it('retains rollback on partial failure and rejects nodes outside scope', async () => {
    const f = fixture();
    f.f.resize.mockImplementationOnce(() => {
      f.f.width = 42;
      throw new Error('write failed');
    });
    const result = await createLayoutToolsHandler(
      f.api,
      'audit_layout',
    )({ nodeId: 'page', changes: [{ id: 'f', width: 42 }] });
    expect(result).toMatchObject({
      errors: [{ id: 'f' }],
      rollback: [{ before: { width: 100 }, after: { width: 42 } }],
    });
    f.nodes.set('outside', { ...f.f, id: 'outside', parent: null });
    expect(
      await createLayoutToolsHandler(
        f.api,
        'relayout_frames',
      )({ nodeId: 'f', changes: [{ id: 'outside', x: 50 }] }),
    ).toMatchObject({ errors: [{ id: 'outside' }], rollback: [] });
  });
});

/** 可改父级的最小画布替身。 */
function flattenFixture() {
  const f = fixture();
  const stage = f.f;
  stage.name = 'stage';
  const shell = {
    ...node('shell', { name: '片段' }),
    resize: f.f.resize,
    parent: stage,
    children: [] as (typeof stage)[],
    insertChild(index: number, child: typeof stage) {
      const siblings = child.parent!.children;
      siblings.splice(siblings.indexOf(child), 1);
      this.children.splice(index, 0, child);
      Object.assign(child, { parent: this });
    },
  };
  const frag = {
    ...node('frag', { name: '片段 · 示例', x: 15, y: 20 }),
    resize: f.f.resize,
    parent: shell,
    children: [],
  };
  Object.assign(stage, {
    insertChild(index: number, child: typeof stage) {
      const siblings = child.parent!.children;
      siblings.splice(siblings.indexOf(child), 1);
      stage.children.splice(index, 0, child);
      Object.assign(child, { parent: stage });
    },
  });
  shell.children.push(frag as unknown as typeof stage);
  stage.children.push(shell);
  f.nodes.set('shell', shell);
  f.nodes.set('frag', frag);
  return { ...f, stage, shell, frag };
}

describe('flatten stage phases', () => {
  it('plans fragment extraction and preserves overview offsets without writes', async () => {
    const f = flattenFixture();
    f.stage.children.push(
      { ...node('mask', { name: '总览 · 遮住下方叠放的变体' }), parent: f.stage },
      { ...node('set', { type: 'COMPONENT_SET' }), parent: f.stage },
      { ...node('note', { name: '提示', type: 'TEXT', x: 10, y: 105 }), parent: f.stage },
    );
    const result = await createLayoutToolsHandler(f.api, 'flatten_stage')({ nodeId: 'page' });
    expect(result).toMatchObject({
      errors: [],
      changes: [
        { id: 'frag', parentId: 'f' },
        { id: 'shell', visible: false },
      ],
      jobs: [
        {
          boxes: [
            { width: 110, height: 205 },
            { width: 100, height: 100 },
          ],
          members: {
            '0': [
              { id: 'mask', x: 0, y: 0 },
              { id: 'set', x: 0, y: 0 },
              { id: 'note', x: 10, y: 105 },
            ],
          },
        },
      ],
    });
    expect(f.frag.parent).toBe(f.shell);
    expect(f.shell.visible).toBe(true);
  });

  it.each([true, false])('retains a shell containing other content (visible=%s)', async visible => {
    const f = flattenFixture();
    f.shell.children.push({
      ...node('other', { type: 'TEXT', visible }),
      parent: f.shell,
    } as unknown as typeof f.stage);
    const result = await createLayoutToolsHandler(f.api, 'flatten_stage')({ nodeId: 'page' });
    expect(result).toMatchObject({ changes: [{ id: 'frag', parentId: 'f' }] });
  });

  it('uses custom stage, fragment and items names', async () => {
    const f = flattenFixture();
    f.stage.name = 'canvas';
    f.shell.name = 'entries';
    f.frag.name = 'part / one';
    expect(
      await createLayoutToolsHandler(
        f.api,
        'flatten_stage',
      )({ nodeId: 'page', stageName: 'canvas', itemsName: 'entries', fragmentPrefix: 'part / ' }),
    ).toMatchObject({
      changes: [
        { id: 'frag', parentId: 'f' },
        { id: 'shell', visible: false },
      ],
    });
  });

  it('records parent, index, position and visibility and can replay rollback', async () => {
    const f = flattenFixture();
    const handle = createLayoutToolsHandler(f.api, 'flatten_stage');
    const result = (await handle({
      nodeId: 'page',
      changes: [
        { id: 'frag', parentId: 'f', x: 50, y: 60 },
        { id: 'shell', visible: false },
      ],
    })) as import('@figwright/shared').LayoutReply;
    expect(result.errors).toEqual([]);
    expect(f.frag.parent).toBe(f.stage);
    expect(f.shell.visible).toBe(false);
    expect(result.rollback[0]?.before).toMatchObject({
      parentId: 'shell',
      childIndex: 0,
      x: 15,
      y: 20,
    });
    expect(
      await handle({ nodeId: 'page', changes: result.rollback.toReversed().map(r => r.before) }),
    ).toMatchObject({ errors: [] });
    expect(f.frag.parent).toBe(f.shell);
    expect(f.frag.x).toBe(15);
    expect(f.frag.y).toBe(20);
    expect(f.shell.visible).toBe(true);
  });
});

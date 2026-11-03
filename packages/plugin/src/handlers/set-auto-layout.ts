import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const LAYOUT_MODES = new Set(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']);

type AutoLayoutTarget = {
  layoutMode: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  primaryAxisAlignItems: string;
  counterAxisAlignItems: string;
  layoutWrap: string;
  counterAxisSpacing: number | null;
  counterAxisAlignContent: string;
  itemReverseZIndex: boolean;
  strokesIncludedInLayout: boolean;
  gridRowCount: number;
  gridColumnCount: number;
  gridRowGap: number;
  gridColumnGap: number;
  gridItemsPositioning: string;
  gridAutoTracks: string;
  gridRowSizes: GridTrackSize[];
  gridColumnSizes: GridTrackSize[];
  children: readonly SceneNode[];
};

/** One caller-supplied track, checked: a FIXED track needs a size, a HUG one takes none. */
const toGridTrack = (raw: unknown, where: string): GridTrackSize => {
  const t = (raw ?? {}) as { type?: unknown; value?: unknown };
  if (t.type !== 'FLEX' && t.type !== 'FIXED' && t.type !== 'HUG') {
    throw new TypeError(`set_auto_layout: ${where}.type must be FLEX / FIXED / HUG`);
  }
  if (t.value !== undefined && (typeof t.value !== 'number' || !(t.value > 0))) {
    throw new TypeError(`set_auto_layout: ${where}.value must be a positive number`);
  }
  if (t.type === 'FIXED' && t.value === undefined) {
    throw new TypeError(`set_auto_layout: ${where} is FIXED, so it needs a value (its size in px)`);
  }
  if (t.type === 'HUG' && t.value !== undefined) {
    throw new TypeError(`set_auto_layout: ${where} is HUG, which takes no value`);
  }
  return t.value === undefined
    ? ({ type: t.type } as GridTrackSize)
    : ({ type: t.type, value: t.value } as GridTrackSize);
};

/**
 * Validate a gridRowSizes / gridColumnSizes argument against the track count the grid will have, so
 * a wrong-length array is refused before anything is written (Figma would throw only after the mode
 * and counts had already been applied). `count` is undefined when it cannot be known up front — a
 * frame not yet a grid with no count in the call (Figma's default grid is not read here), or rows
 * Figma manages itself under gridAutoTracks ROWS — and the length is then left for Figma to judge:
 * a failure there can come after the mode switch, and the caller writes the hint for it.
 */
const parseGridTracks = (
  raw: unknown,
  key: 'gridRowSizes' | 'gridColumnSizes',
  count: number | undefined,
): GridTrackSize[] | undefined => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TypeError(`set_auto_layout: ${key} must be a non-empty array`);
  }
  if (count !== undefined && raw.length !== count) {
    throw new Error(
      `set_auto_layout: ${key} has ${raw.length} tracks but the grid will have ${count} — pass ` +
        `one track per ${key === 'gridRowSizes' ? 'row' : 'column'}, or change the count in the ` +
        'same call',
    );
  }
  return raw.map((t, i) => toGridTrack(t, `${key}[${i}]`));
};

/** A child Figma left without a cell: anchor -1 on either axis, outside an absolute escape. */
const withoutCell = (child: SceneNode): boolean => {
  const c = child as SceneNode & {
    gridRowAnchorIndex?: number;
    gridColumnAnchorIndex?: number;
    layoutPositioning?: string;
  };
  return (
    c.layoutPositioning !== 'ABSOLUTE' &&
    ((c.gridRowAnchorIndex ?? 0) < 0 || (c.gridColumnAnchorIndex ?? 0) < 0)
  );
};

export const createSetAutoLayoutHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_auto_layout: nodeId must be a string');
    if (typeof p.layoutMode !== 'string' || !LAYOUT_MODES.has(p.layoutMode)) {
      throw new TypeError(
        'set_auto_layout: layoutMode must be NONE / HORIZONTAL / VERTICAL / GRID',
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('layoutMode' in node)) {
      throw new Error(`set_auto_layout: node ${p.nodeId} not found or has no auto layout`);
    }
    const target = node as unknown as AutoLayoutTarget;

    // Wrap cross-axis (counterAxisSpacing / counterAxisAlignContent → CSS row-gap, column-gap on a
    // vertical wrap / align-content) is only meaningful on a wrapping flex. Validate BEFORE any
    // mutation — this is a contradiction in the inputs, and rejecting it after layoutWrap was already
    // applied would leave a partial change behind (caught live). Rejected loudly rather than
    // deferred to Figma, whose silent ignore is the worst failure mode for an authoring tool.
    const wantsCrossAxis =
      p.counterAxisSpacing !== undefined || p.counterAxisAlignContent !== undefined;
    if (wantsCrossAxis && (p.layoutMode === 'HORIZONTAL' || p.layoutMode === 'VERTICAL')) {
      const effectiveWrap = typeof p.layoutWrap === 'string' ? p.layoutWrap : target.layoutWrap;
      if (effectiveWrap !== 'WRAP') {
        throw new Error(
          'set_auto_layout: counterAxisSpacing / counterAxisAlignContent apply only to a ' +
            'wrapping flex — pass layoutWrap: "WRAP" (in this call or before)',
        );
      }
    }

    // Track sizes are checked against the count the grid will end up with, before any write. Rows
    // under gridAutoTracks ROWS have no count of their own to check against.
    let rowSizes: GridTrackSize[] | undefined;
    let columnSizes: GridTrackSize[] | undefined;
    // True when a sizes array could not be length-checked up front, so Figma's own check may fire
    // after the frame has already switched to GRID.
    let unverifiedSizes = false;
    if (p.layoutMode === 'GRID') {
      const wasGrid = target.layoutMode === 'GRID';
      const rowsAuto = (p.gridAutoTracks ?? (wasGrid ? target.gridAutoTracks : 'NONE')) === 'ROWS';
      const rowCount =
        typeof p.gridRowCount === 'number'
          ? p.gridRowCount
          : wasGrid
            ? target.gridRowCount
            : undefined;
      const columnCount =
        typeof p.gridColumnCount === 'number'
          ? p.gridColumnCount
          : wasGrid
            ? target.gridColumnCount
            : undefined;
      rowSizes = parseGridTracks(p.gridRowSizes, 'gridRowSizes', rowsAuto ? undefined : rowCount);
      columnSizes = parseGridTracks(p.gridColumnSizes, 'gridColumnSizes', columnCount);
      // GridTrackSize's typings forbid FLEX on a HUG axis. An existing GRID keeps its sizing;
      // on a mode transition Figma chooses the resulting sizing, so leave that case to its setter.
      if (wasGrid) {
        for (const [key, sizes, sizing] of [
          ['gridRowSizes', rowSizes, target.layoutSizingVertical],
          ['gridColumnSizes', columnSizes, target.layoutSizingHorizontal],
        ] as const) {
          if (sizing === 'HUG' && sizes?.some(track => track.type === 'FLEX')) {
            throw new Error(
              `set_auto_layout: ${key} cannot contain FLEX while its container axis is HUG — ` +
                'set that axis to FIXED or FILL first, or use FIXED / HUG tracks; nothing was changed',
            );
          }
        }
      }
      unverifiedSizes =
        (rowSizes !== undefined && (rowsAuto || rowCount === undefined)) ||
        (columnSizes !== undefined && columnCount === undefined);
    } else if (p.gridRowSizes !== undefined || p.gridColumnSizes !== undefined) {
      // NONE included: sizes the call cannot apply are an error, not a silent ok.
      throw new Error(
        'set_auto_layout: gridRowSizes / gridColumnSizes apply to layoutMode GRID only — ' +
          `layoutMode ${p.layoutMode} has no tracks`,
      );
    }

    // While gridAutoTracks is ROWS, Figma owns the row count and throws on any write to it — even
    // of the value it already has (measured). A fresh GRID starts at NONE (measured).
    if (p.layoutMode === 'GRID' && typeof p.gridRowCount === 'number') {
      const currentAutoTracks = target.layoutMode === 'GRID' ? target.gridAutoTracks : 'NONE';
      if ((p.gridAutoTracks ?? currentAutoTracks) === 'ROWS') {
        throw new Error(
          'set_auto_layout: gridRowCount is managed by Figma while gridAutoTracks is ROWS — ' +
            'omit it, or pass gridAutoTracks: "NONE" to set the row count yourself',
        );
      }
    }

    // A flowing grid back to MANUAL: Figma returns each child to the cell it held the last time the
    // grid was MANUAL — and leaves a child that never held one, or whose cell no longer exists,
    // with no cell at all (measured: a grid that was born flowing lost every child's cell and
    // collapsed to one row; children overlapped). That cannot be checked beforehand, so it is tried
    // before anything else is written, and undone exactly when it fails: under ROW_AUTO_FLOW the
    // cells are a function of layer order alone.
    if (
      p.layoutMode === 'GRID' &&
      p.gridItemsPositioning === 'MANUAL' &&
      target.layoutMode === 'GRID' &&
      target.gridItemsPositioning === 'ROW_AUTO_FLOW'
    ) {
      target.gridItemsPositioning = 'MANUAL';
      const lost = target.children.filter(withoutCell).length;
      if (lost > 0) {
        target.gridItemsPositioning = 'ROW_AUTO_FLOW';
        throw new Error(
          `set_auto_layout: switching ${node.id} to MANUAL would leave ${lost} of its ` +
            `${target.children.length} children without a cell — Figma only puts a child back ` +
            'in a cell it held before the grid flowed, and only while that cell still exists. ' +
            'Nothing was changed; keep ROW_AUTO_FLOW',
        );
      }
    }

    // Set the mode first: grid counts / gaps only become writable once layoutMode is GRID. Only when
    // it changes — assigning GRID to a frame that is already GRID resets it to Figma's default grid
    // (measured: a 3-column grid came back with 2 columns and every child re-placed, no error).
    if (target.layoutMode !== p.layoutMode) target.layoutMode = p.layoutMode;

    if (p.layoutMode !== 'NONE') {
      // padding is common to HORIZONTAL / VERTICAL / GRID
      for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
        if (typeof p[key] === 'number') target[key] = p[key] as number;
      }
      if (p.layoutMode === 'GRID') {
        // The modes go around the counts: NONE and ROW_AUTO_FLOW before them, so the row count is
        // writable and a column cut re-flows the children (measured) instead of hitting an occupied
        // cell; ROWS after them. MANUAL was settled above, before anything else.
        if (p.gridAutoTracks === 'NONE') target.gridAutoTracks = 'NONE';
        if (p.gridItemsPositioning === 'ROW_AUTO_FLOW')
          target.gridItemsPositioning = 'ROW_AUTO_FLOW';
        for (const key of [
          'gridRowCount',
          'gridColumnCount',
          'gridRowGap',
          'gridColumnGap',
        ] as const) {
          if (typeof p[key] === 'number') target[key] = p[key] as number;
        }
        // Track sizes follow the counts they are sized against.
        try {
          if (rowSizes !== undefined) target.gridRowSizes = rowSizes;
          if (columnSizes !== undefined) target.gridColumnSizes = columnSizes;
        } catch (err) {
          if (!unverifiedSizes) throw err;
          throw new Error(
            `set_auto_layout: Figma refused the track sizes (${err instanceof Error ? err.message : String(err)}). ` +
              'Their length could not be checked beforehand (the frame was not a grid yet or has ' +
              'gridAutoTracks ROWS), so the frame may already have switched to GRID with the other ' +
              'values applied — retry with arrays matching the real track counts (pass ' +
              'gridColumnCount, and gridRowCount unless gridAutoTracks is ROWS, where Figma manages ' +
              'the row count — set gridAutoTracks NONE first to give it), or restore it by hand',
            { cause: err },
          );
        }
        if (p.gridAutoTracks === 'ROWS') target.gridAutoTracks = 'ROWS';
      } else {
        if (typeof p.itemSpacing === 'number') target.itemSpacing = p.itemSpacing;
        if (typeof p.primaryAxisAlignItems === 'string')
          target.primaryAxisAlignItems = p.primaryAxisAlignItems;
        if (typeof p.counterAxisAlignItems === 'string')
          target.counterAxisAlignItems = p.counterAxisAlignItems;
        if (typeof p.layoutWrap === 'string') target.layoutWrap = p.layoutWrap;
        // Wrap cross-axis, validated up front; applied after layoutWrap so enabling wrap and
        // setting its track gap works in one call.
        if (typeof p.counterAxisSpacing === 'number')
          target.counterAxisSpacing = p.counterAxisSpacing;
        if (typeof p.counterAxisAlignContent === 'string')
          target.counterAxisAlignContent = p.counterAxisAlignContent;
        // Paint order / stroke-in-layout — the write mirrors of the serializer's new reads.
        if (typeof p.itemReverseZIndex === 'boolean')
          target.itemReverseZIndex = p.itemReverseZIndex;
        if (typeof p.strokesIncludedInLayout === 'boolean')
          target.strokesIncludedInLayout = p.strokesIncludedInLayout;
      }
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };

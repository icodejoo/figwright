import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const ALIGNS = new Set(['MIN', 'CENTER', 'MAX', 'AUTO']);

type GridChild = SceneNode & {
  gridRowAnchorIndex: number;
  gridColumnAnchorIndex: number;
  gridRowSpan: number;
  gridColumnSpan: number;
  gridChildHorizontalAlign: string;
  gridChildVerticalAlign: string;
  setGridChildPosition: (row: number, column: number) => void;
};

/** A non-negative integer field, or undefined when not given; anything else is a caller error. */
const indexField = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`set_grid_child: ${name} must be a non-negative integer`);
  }
  return value;
};

const spanField = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`set_grid_child: ${name} must be a positive integer`);
  }
  return value;
};

const alignField = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ALIGNS.has(value)) {
    throw new TypeError(`set_grid_child: ${name} must be MIN / CENTER / MAX / AUTO`);
  }
  return value;
};

/**
 * Place and align one child of a GRID frame: its cell (setGridChildPosition — the anchors are
 * read-only properties), its row / column span, and where it sits inside the cell.
 *
 * Everything that can be refused on the caller's input is refused before the first write. What only
 * Figma can judge — a cell that is occupied or out of range, a span that overlaps another child or
 * runs past the last track — can fail partway, so the child's whole placement is captured first and
 * put back if a write throws: the call changes the child entirely or not at all. Writing the cell
 * first would trip over the child's own old span, so a move collapses the spans to 1, moves, and
 * only then applies the requested (or the original) spans.
 */
export const createSetGridChildHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_grid_child: nodeId must be a string');
    }
    const row = indexField(p.rowAnchorIndex, 'rowAnchorIndex');
    const column = indexField(p.columnAnchorIndex, 'columnAnchorIndex');
    if ((row === undefined) !== (column === undefined)) {
      throw new TypeError(
        'set_grid_child: rowAnchorIndex and columnAnchorIndex go together — a cell is a row and a column',
      );
    }
    const rowSpan = spanField(p.rowSpan, 'rowSpan');
    const columnSpan = spanField(p.columnSpan, 'columnSpan');
    const horizontal = alignField(p.horizontalAlign, 'horizontalAlign');
    const vertical = alignField(p.verticalAlign, 'verticalAlign');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    const parent = (node as SceneNode | null)?.parent as
      | (BaseNode & { layoutMode?: string; gridItemsPositioning?: string })
      | null
      | undefined;
    if (node === null || parent?.layoutMode !== 'GRID') {
      throw new Error(`set_grid_child: node ${p.nodeId} is not a direct child of a GRID frame`);
    }
    const child = node as GridChild;
    if (row !== undefined && parent.gridItemsPositioning === 'ROW_AUTO_FLOW') {
      throw new Error(
        `set_grid_child: ${parent.id} places its children by layer order (ROW_AUTO_FLOW), so a ` +
          'cell cannot be set — reorder with reorder_nodes, or set gridItemsPositioning MANUAL',
      );
    }

    const before = {
      row: child.gridRowAnchorIndex,
      column: child.gridColumnAnchorIndex,
      rowSpan: child.gridRowSpan,
      columnSpan: child.gridColumnSpan,
      horizontal: child.gridChildHorizontalAlign,
      vertical: child.gridChildVerticalAlign,
    };
    try {
      if (row !== undefined && column !== undefined) {
        if (child.gridRowSpan !== 1) child.gridRowSpan = 1;
        if (child.gridColumnSpan !== 1) child.gridColumnSpan = 1;
        child.setGridChildPosition(row, column);
        // A move keeps the child's old span unless a new one is asked for.
        if ((rowSpan ?? before.rowSpan) !== 1) child.gridRowSpan = rowSpan ?? before.rowSpan;
        if ((columnSpan ?? before.columnSpan) !== 1) {
          child.gridColumnSpan = columnSpan ?? before.columnSpan;
        }
      } else {
        if (rowSpan !== undefined) child.gridRowSpan = rowSpan;
        if (columnSpan !== undefined) child.gridColumnSpan = columnSpan;
      }
      if (horizontal !== undefined) child.gridChildHorizontalAlign = horizontal;
      if (vertical !== undefined) child.gridChildVerticalAlign = vertical;
    } catch (error) {
      try {
        child.gridRowSpan = 1;
        child.gridColumnSpan = 1;
        if (
          child.gridRowAnchorIndex !== before.row ||
          child.gridColumnAnchorIndex !== before.column
        ) {
          child.setGridChildPosition(before.row, before.column);
        }
        child.gridRowSpan = before.rowSpan;
        child.gridColumnSpan = before.columnSpan;
        child.gridChildHorizontalAlign = before.horizontal;
        child.gridChildVerticalAlign = before.vertical;
      } catch {
        // Best effort — the original failure is the one worth reporting.
      }
      throw new Error(
        `set_grid_child: Figma refused the placement of ${p.nodeId} (${
          error instanceof Error ? error.message : String(error)
        }); the child was left as it was`,
        { cause: error },
      );
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };

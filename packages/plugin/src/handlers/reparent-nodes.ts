import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Move nodes into a new parent (optionally at a given index). Invalid nodes are skipped. */
export const createReparentNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeIds?: unknown;
      newParentId?: unknown;
      index?: unknown;
      rowAnchorIndex?: unknown;
      columnAnchorIndex?: unknown;
    };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('reparent_nodes: nodeIds must be a string[]');
    }
    if (typeof p.newParentId !== 'string') {
      throw new TypeError('reparent_nodes: newParentId must be a string');
    }
    const parent = await figmaCtx.getNodeByIdAsync(p.newParentId);
    if (parent === null || !('appendChild' in parent)) {
      throw new Error(
        `reparent_nodes: parent ${p.newParentId} not found or cannot contain children`,
      );
    }
    const pm = parent as ChildrenMixin;
    // A cell for a GRID parent. Everything that can be refused on the arguments alone is refused
    // before the first node moves.
    const hasRow = p.rowAnchorIndex !== undefined;
    const hasColumn = p.columnAnchorIndex !== undefined;
    if (hasRow !== hasColumn) {
      throw new TypeError(
        'reparent_nodes: rowAnchorIndex and columnAnchorIndex go together — a cell is a row and a column',
      );
    }
    let cell: { row: number; column: number } | undefined;
    if (hasRow) {
      const { rowAnchorIndex: row, columnAnchorIndex: column } = p;
      if (
        typeof row !== 'number' ||
        typeof column !== 'number' ||
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        column < 0
      ) {
        throw new TypeError('reparent_nodes: rowAnchorIndex / columnAnchorIndex must be indices');
      }
      const grid = parent as BaseNode & { layoutMode?: string; gridItemsPositioning?: string };
      if (grid.layoutMode !== 'GRID') {
        throw new Error(`reparent_nodes: ${p.newParentId} is not a GRID frame, so it has no cells`);
      }
      if (grid.gridItemsPositioning === 'ROW_AUTO_FLOW') {
        throw new Error(
          `reparent_nodes: ${p.newParentId} places its children by layer order (ROW_AUTO_FLOW), ` +
            'so a cell cannot be chosen — drop the cell arguments, or set it to MANUAL',
        );
      }
      if (p.nodeIds.length !== 1) {
        throw new Error('reparent_nodes: a cell holds one node — pass exactly one nodeId with it');
      }
      if (p.index !== undefined) {
        throw new TypeError('reparent_nodes: pass a cell or an index, not both');
      }
      cell = { row, column };
    }
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const index = typeof p.index === 'number' ? p.index : undefined;

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('parent' in node)) return;
      const child = node as SceneNode;
      if (cell !== undefined) {
        (pm as unknown as GridLayoutMixin).appendChildAt(child, cell.row, cell.column);
      } else if (index === undefined) pm.appendChild(child);
      else pm.insertChild(index, child);
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };

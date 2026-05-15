import { compareDots, cloneDot } from "./dot.js";
import { canonicalSerialize } from "../serialize/canonical.js";
import { cloneCell, cloneRow } from "../storage/row.js";
import type { CellState, RowState, TableState, TombstoneState } from "../storage/types.js";

export function mergeCell(a: CellState | undefined, b: CellState | undefined): CellState | undefined {
  if (!a) return b ? cloneCell(b) : undefined;
  if (!b) return cloneCell(a);

  const dotOrder = compareDots(a.dot, b.dot);
  if (dotOrder > 0) return cloneCell(a);
  if (dotOrder < 0) return cloneCell(b);

  const aValue = canonicalSerialize(a.value);
  const bValue = canonicalSerialize(b.value);
  return aValue <= bValue ? cloneCell(a) : cloneCell(b);
}

export function mergeTombstone(
  a: TombstoneState | undefined,
  b: TombstoneState | undefined
): TombstoneState | undefined {
  if (!a) return b ? { dot: cloneDot(b.dot), reason: b.reason } : undefined;
  if (!b) return { dot: cloneDot(a.dot), reason: a.reason };

  const dotOrder = compareDots(a.dot, b.dot);
  if (dotOrder > 0) return { dot: cloneDot(a.dot), reason: a.reason };
  if (dotOrder < 0) return { dot: cloneDot(b.dot), reason: b.reason };
  return a.reason <= b.reason
    ? { dot: cloneDot(a.dot), reason: a.reason }
    : { dot: cloneDot(b.dot), reason: b.reason };
}

export function mergeRow(a: RowState | undefined, b: RowState | undefined): RowState | undefined {
  if (!a) return b ? cloneRow(b) : undefined;
  if (!b) return cloneRow(a);

  const cells: RowState["cells"] = {};
  const columns = Array.from(new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])).sort();
  for (const column of columns) {
    const aCell = Object.prototype.hasOwnProperty.call(a.cells, column) ? a.cells[column] : undefined;
    const bCell = Object.prototype.hasOwnProperty.call(b.cells, column) ? b.cells[column] : undefined;
    const merged = mergeCell(aCell, bCell);
    if (merged) cells[column] = merged;
  }

  const merged: RowState = { cells };
  const tombstone = mergeTombstone(a.tombstone, b.tombstone);
  if (tombstone) merged.tombstone = tombstone;
  return merged;
}

export function mergeTable(a: TableState | undefined, b: TableState | undefined): TableState {
  const rows: TableState["rows"] = {};
  const rowIds = Array.from(
    new Set([...Object.keys(a?.rows ?? {}), ...Object.keys(b?.rows ?? {})])
  ).sort();

  for (const rowId of rowIds) {
    const aRow = Object.prototype.hasOwnProperty.call(a?.rows ?? {}, rowId) ? a!.rows[rowId] : undefined;
    const bRow = Object.prototype.hasOwnProperty.call(b?.rows ?? {}, rowId) ? b!.rows[rowId] : undefined;
    const merged = mergeRow(aRow, bRow);
    if (merged) rows[rowId] = merged;
  }
  return { rows };
}

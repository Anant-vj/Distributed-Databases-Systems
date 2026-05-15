import { compareDots, cloneDot } from "../merge/dot.js";
import type { CellState, Dot, RowState, Scalar, TableSchema, TombstoneState } from "./types.js";

export function emptyRow(): RowState {
  return { cells: {} };
}

export function cloneCell(cell: CellState): CellState {
  return { value: cell.value, dot: cloneDot(cell.dot) };
}

export function cloneRow(row: RowState): RowState {
  const cells: Record<string, CellState> = {};
  for (const column of Object.keys(row.cells).sort()) {
    cells[column] = cloneCell(row.cells[column]!);
  }
  const copy: RowState = { cells };
  if (row.tombstone) {
    copy.tombstone = { dot: cloneDot(row.tombstone.dot), reason: row.tombstone.reason };
  }
  return copy;
}

export function isCellVisible(cell: CellState | undefined, row: RowState): boolean {
  if (!cell) return false;
  if (!row.tombstone) return true;
  return compareDots(cell.dot, row.tombstone.dot) > 0;
}

export function materializeRow(row: RowState, schema: TableSchema): Record<string, Scalar> | null {
  const primary = row.cells[schema.primaryKey];
  if (!isCellVisible(primary, row)) return null;

  const result: Record<string, Scalar> = {};
  for (const column of schema.columnOrder) {
    const cell = row.cells[column];
    result[column] = isCellVisible(cell, row) ? cell!.value : null;
  }
  return result;
}

export function rowMaxCounter(row: RowState): number {
  let max = row.tombstone?.dot.counter ?? 0;
  for (const cell of Object.values(row.cells)) {
    if (cell.dot.counter > max) max = cell.dot.counter;
  }
  return max;
}

export function rowHasVisiblePrimaryKey(row: RowState, schema: TableSchema): boolean {
  return isCellVisible(row.cells[schema.primaryKey], row);
}

export function setCells(row: RowState | undefined, values: Record<string, Scalar>, dot: Dot): RowState {
  const next = row ? cloneRow(row) : emptyRow();
  for (const [column, value] of Object.entries(values)) {
    next.cells[column] = { value, dot: cloneDot(dot) };
  }
  return next;
}

export function setTombstone(row: RowState | undefined, tombstone: TombstoneState): RowState {
  const next = row ? cloneRow(row) : emptyRow();
  if (!next.tombstone || compareDots(tombstone.dot, next.tombstone.dot) > 0) {
    next.tombstone = { dot: cloneDot(tombstone.dot), reason: tombstone.reason };
  }
  return next;
}

import { compareScalars, compareStrings } from "../serialize/stable.js";
import { materializeRow } from "../storage/row.js";
import type { PeerState, Scalar, TableSchema } from "../storage/types.js";
import type { Condition, OrderBy, SelectStatement } from "./sql.js";

export type QueryRow = Record<string, Scalar>;

export function selectRows(peer: PeerState, statement: SelectStatement): QueryRow[] {
  const tableSchema = peer.schema.tables[statement.table];
  const table = peer.tables[statement.table];
  if (!tableSchema || !table) throw new Error(`Unknown table: ${statement.table}`);

  const rows: QueryRow[] = [];
  for (const primaryKey of Object.keys(table.rows).sort()) {
    if (!peer.unique.loserRows[`${statement.table}:${primaryKey}`]) {
      const materialized = materializeRow(table.rows[primaryKey]!, tableSchema);
      if (materialized && matchesConditions(materialized, statement.conditions)) {
        rows.push(projectRow(materialized, statement.columns, tableSchema));
      }
    }
  }

  rows.sort((a, b) => compareRows(a, b, tableSchema, statement, peer));
  return rows;
}

export function visibleRowsForConditions(
  peer: PeerState,
  tableName: string,
  conditions: Condition[]
): Array<{ primaryKey: string; row: QueryRow }> {
  const tableSchema = peer.schema.tables[tableName];
  const table = peer.tables[tableName];
  if (!tableSchema || !table) throw new Error(`Unknown table: ${tableName}`);

  const rows: Array<{ primaryKey: string; row: QueryRow }> = [];
  for (const primaryKey of Object.keys(table.rows).sort()) {
    if (peer.unique.loserRows[`${tableName}:${primaryKey}`]) continue;
    const row = materializeRow(table.rows[primaryKey]!, tableSchema);
    if (row && matchesConditions(row, conditions)) rows.push({ primaryKey, row });
  }
  rows.sort((a, b) => compareStrings(a.primaryKey, b.primaryKey));
  return rows;
}

function matchesConditions(row: QueryRow, conditions: Condition[]): boolean {
  return conditions.every((condition) => row[condition.column] === condition.value);
}

function projectRow(row: QueryRow, columns: string[] | "*", schema: TableSchema): QueryRow {
  const projected: QueryRow = {};
  const selected = columns === "*" ? schema.columnOrder : columns;
  for (const column of selected) projected[column] = row[column] ?? null;
  return projected;
}

function compareRows(
  a: QueryRow,
  b: QueryRow,
  schema: TableSchema,
  statement: SelectStatement,
  peer: PeerState
): number {
  const orderBy = statement.orderBy.length > 0 ? statement.orderBy : implicitOrderBy(schema, statement, peer);
  for (const term of orderBy) {
    const order = compareScalars(a[term.column] ?? null, b[term.column] ?? null);
    if (order !== 0) return term.direction === "asc" ? order : -order;
  }
  return compareScalars(a[schema.primaryKey] ?? null, b[schema.primaryKey] ?? null);
}

function implicitOrderBy(schema: TableSchema, statement: SelectStatement, peer: PeerState): OrderBy[] {
  const conditionColumns = new Set(statement.conditions.map((condition) => condition.column));
  const indexes = Object.values(peer.schema.indexes)
    .filter((index) => index.table === statement.table)
    .sort((a, b) => compareStrings(a.name, b.name));

  for (const index of indexes) {
    if (index.columns.length > 0 && conditionColumns.has(index.columns[0]!)) {
      return index.columns.map((column) => ({ column, direction: "asc" as const }));
    }
  }
  return [{ column: schema.primaryKey, direction: "asc" }];
}

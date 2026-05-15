import { canonicalSerialize } from "../serialize/canonical.js";
import { compareScalars, compareStrings } from "../serialize/stable.js";
import { materializeRow } from "../storage/row.js";
import type { RowState, Scalar, SchemaState, TableState } from "../storage/types.js";

export interface UniqueConflictRecord {
  conflictId: string;
  table: string;
  column: string;
  value: Scalar;
  winnerPk: string;
  loserPk: string;
  loserSnapshot: Record<string, Scalar>;
  recoverable: true;
}

export interface UniqueReservationStore {
  reservations: Record<string, string>;
  loserRows: Record<string, true>;
  conflicts: UniqueConflictRecord[];
}

export interface UniqueConstraintPolicy {
  rebuild(schema: SchemaState, tables: Record<string, TableState>): UniqueReservationStore;
  isVisible(store: UniqueReservationStore, table: string, primaryKey: string): boolean;
}

export function emptyUniqueReservationStore(): UniqueReservationStore {
  return { reservations: {}, loserRows: {}, conflicts: [] };
}

function reservationKey(table: string, column: string, value: Scalar): string {
  return `${table}.${column}:${canonicalSerialize(value)}`;
}

function compareReservations(
  a: { primaryKey: string; row: Record<string, Scalar> },
  b: { primaryKey: string; row: Record<string, Scalar> }
): number {
  return compareStrings(a.primaryKey, b.primaryKey);
}

export class DefaultUniqueConstraintPolicy implements UniqueConstraintPolicy {
  rebuild(schema: SchemaState, tables: Record<string, TableState>): UniqueReservationStore {
    const groups = new Map<string, Array<{ primaryKey: string; row: Record<string, Scalar> }>>();
    const keyParts = new Map<string, { table: string; column: string; value: Scalar }>();

    for (const tableName of Object.keys(schema.tables).sort()) {
      const tableSchema = schema.tables[tableName]!;
      const table = tables[tableName];
      if (!table) continue;

      const uniqueColumns = tableSchema.columnOrder.filter((column) => tableSchema.columns[column]?.unique);
      for (const primaryKey of Object.keys(table.rows).sort()) {
        const row = materializeRow(table.rows[primaryKey] as RowState, tableSchema);
        if (!row) continue;

        for (const column of uniqueColumns) {
          const value = row[column] ?? null;
          const key = reservationKey(tableName, column, value);
          groups.set(key, [...(groups.get(key) ?? []), { primaryKey, row }]);
          keyParts.set(key, { table: tableName, column, value });
        }
      }
    }

    const store = emptyUniqueReservationStore();
    for (const key of Array.from(groups.keys()).sort()) {
      const rows = groups.get(key)!.sort(compareReservations);
      const parts = keyParts.get(key)!;
      const winner = rows[0]!;
      store.reservations[key] = winner.primaryKey;

      for (const loser of rows.slice(1)) {
        const conflictId = `${key}|loser:${loser.primaryKey}`;
        store.loserRows[`${parts.table}:${loser.primaryKey}`] = true;
        store.conflicts.push({
          conflictId,
          table: parts.table,
          column: parts.column,
          value: parts.value,
          winnerPk: winner.primaryKey,
          loserPk: loser.primaryKey,
          loserSnapshot: orderRowSnapshot(loser.row),
          recoverable: true
        });
      }
    }

    store.conflicts.sort((a, b) => {
      const valueOrder = compareScalars(a.value, b.value);
      if (a.table !== b.table) return compareStrings(a.table, b.table);
      if (a.column !== b.column) return compareStrings(a.column, b.column);
      if (valueOrder !== 0) return valueOrder;
      return compareStrings(a.loserPk, b.loserPk);
    });
    return store;
  }

  isVisible(store: UniqueReservationStore, table: string, primaryKey: string): boolean {
    return !store.loserRows[`${table}:${primaryKey}`];
  }
}

function orderRowSnapshot(row: Record<string, Scalar>): Record<string, Scalar> {
  const ordered: Record<string, Scalar> = {};
  for (const key of Object.keys(row).sort()) ordered[key] = row[key] ?? null;
  return ordered;
}

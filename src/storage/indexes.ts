import { compareScalars, compareStrings } from "../serialize/stable.js";
import { materializeRow } from "./row.js";
import type { PeerState, Scalar } from "./types.js";

export interface DerivedIndexEntry {
  key: Scalar[];
  primaryKey: string;
}

export type DerivedIndexState = Record<string, Record<string, DerivedIndexEntry[]>>;

function compareIndexEntries(a: DerivedIndexEntry, b: DerivedIndexEntry): number {
  const length = Math.max(a.key.length, b.key.length);
  for (let index = 0; index < length; index += 1) {
    const order = compareScalars(a.key[index] ?? null, b.key[index] ?? null);
    if (order !== 0) return order;
  }
  return compareStrings(a.primaryKey, b.primaryKey);
}

export function deriveIndexes(peer: PeerState): DerivedIndexState {
  const derived: DerivedIndexState = {};
  for (const indexName of Object.keys(peer.schema.indexes).sort()) {
    const index = peer.schema.indexes[indexName]!;
    const tableSchema = peer.schema.tables[index.table];
    const table = peer.tables[index.table];
    if (!tableSchema || !table) continue;

    const entries: DerivedIndexEntry[] = [];
    for (const primaryKey of Object.keys(table.rows).sort()) {
      if (peer.unique.loserRows[`${index.table}:${primaryKey}`]) continue;
      const row = materializeRow(table.rows[primaryKey]!, tableSchema);
      if (!row) continue;
      entries.push({
        key: index.columns.map((column) => row[column] ?? null),
        primaryKey
      });
    }
    entries.sort(compareIndexEntries);
    derived[index.table] ??= {};
    derived[index.table]![indexName] = entries;
  }
  return derived;
}

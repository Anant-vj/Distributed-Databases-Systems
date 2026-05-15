import { snapshotHash } from "../serialize/canonical.js";
import { mergeRow } from "../merge/merge.js";
import type { ForeignKeyPolicy } from "../policies/foreignKeys.js";
import type { UniqueConstraintPolicy } from "../policies/unique.js";
import { ensureTablesForSchema, mergeSchemas } from "../storage/schema.js";
import { compactMetadata, observePeerState } from "../storage/metadata.js";
import type { PeerState, RowState } from "../storage/types.js";

export interface SyncStats {
  rowsCompared: number;
  rowsMerged: number;
}

export interface SyncOptions {
  foreignKeyPolicy: ForeignKeyPolicy;
  uniquePolicy: UniqueConstraintPolicy;
}

export function syncPeerStates(a: PeerState, b: PeerState, options: SyncOptions): SyncStats {
  const schema = mergeSchemas(a.schema, b.schema);
  a.schema = schema;
  b.schema = structuredClone(schema);
  ensureTablesForSchema(a.tables, a.schema);
  ensureTablesForSchema(b.tables, b.schema);

  let rowsCompared = 0;
  let rowsMerged = 0;

  for (const tableName of Object.keys(schema.tables).sort()) {
    a.tables[tableName] ??= { rows: {} };
    b.tables[tableName] ??= { rows: {} };
    const aTable = a.tables[tableName]!;
    const bTable = b.tables[tableName]!;
    const primaryKeys = Array.from(new Set([...Object.keys(aTable.rows), ...Object.keys(bTable.rows)])).sort();

    for (const primaryKey of primaryKeys) {
      rowsCompared += 1;
      const left = aTable.rows[primaryKey];
      const right = bTable.rows[primaryKey];
      const leftHash = left ? snapshotHash(left) : "";
      const rightHash = right ? snapshotHash(right) : "";
      if (leftHash === rightHash) continue;

      const merged = mergeRow(left, right) as RowState;
      aTable.rows[primaryKey] = structuredClone(merged);
      bTable.rows[primaryKey] = structuredClone(merged);
      rowsMerged += 1;
    }
  }

  observePeerState(a);
  observePeerState(b);
  options.foreignKeyPolicy.apply(a);
  options.foreignKeyPolicy.apply(b);
  compactMetadata(a);
  compactMetadata(b);
  a.unique = options.uniquePolicy.rebuild(a.schema, a.tables);
  b.unique = options.uniquePolicy.rebuild(b.schema, b.tables);

  return { rowsCompared, rowsMerged };
}

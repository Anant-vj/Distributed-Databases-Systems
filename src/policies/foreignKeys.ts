import { nextDot } from "../storage/metadata.js";
import { materializeRow, rowMaxCounter, setCells, setTombstone } from "../storage/row.js";
import type { PeerState, TableSchema } from "../storage/types.js";

export type ForeignKeyMode = "cascade" | "tombstone" | "orphan";

export interface ForeignKeyPolicy {
  mode: ForeignKeyMode;
  apply(peer: PeerState): boolean;
}

export class DefaultForeignKeyPolicy implements ForeignKeyPolicy {
  constructor(public readonly mode: ForeignKeyMode = "tombstone") {}

  apply(peer: PeerState): boolean {
    if (this.mode === "tombstone") return false;

    let changed = false;
    for (const childTableName of Object.keys(peer.schema.tables).sort()) {
      const childSchema = peer.schema.tables[childTableName]!;
      const childTable = peer.tables[childTableName];
      if (!childTable) continue;

      for (const column of childSchema.columnOrder) {
        const reference = childSchema.columns[column]?.references;
        if (!reference) continue;

        const parentSchema = peer.schema.tables[reference.table];
        const parentTable = peer.tables[reference.table];
        if (!parentSchema || !parentTable) continue;

        for (const childPk of Object.keys(childTable.rows).sort()) {
          const childRow = childTable.rows[childPk]!;
          const materializedChild = materializeRow(childRow, childSchema);
          if (!materializedChild) continue;

          const parentKey = materializedChild[column];
          if (typeof parentKey !== "string") continue;

          const parentRow = parentTable.rows[parentKey];
          const parentMaterialized = parentRow ? materializeRow(parentRow, parentSchema as TableSchema) : null;
          const parentMissing = !parentMaterialized;
          if (!parentMissing) continue;

          if (this.mode === "orphan") {
            if (materializedChild[column] === "__orphan__") continue;
            childTable.rows[childPk] = setCells(childRow, { [column]: "__orphan__" }, nextDot(peer));
            changed = true;
            continue;
          }

          const counter = rowMaxCounter(childRow) + 1;
          childTable.rows[childPk] = setTombstone(childRow, {
            dot: { peerId: `system:fk:${this.mode}`, counter },
            reason: "fk-cascade"
          });
          changed = true;
        }
      }
    }
    return changed;
  }
}

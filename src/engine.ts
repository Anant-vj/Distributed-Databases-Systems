import { snapshotHash as hashSnapshot } from "./serialize/canonical.js";
import { canonicalize, hashCanonical } from "./serialize/stable.js";
import { DefaultForeignKeyPolicy, type ForeignKeyPolicy } from "./policies/foreignKeys.js";
import {
  DefaultUniqueConstraintPolicy,
  emptyUniqueReservationStore,
  type UniqueConstraintPolicy
} from "./policies/unique.js";
import { parseSql, type DeleteStatement, type InsertStatement, type UpdateStatement } from "./query/sql.js";
import { selectRows, visibleRowsForConditions } from "./query/query.js";
import { syncPeerStates, type SyncStats } from "./sync/sync.js";
import { deriveIndexes } from "./storage/indexes.js";
import { compactMetadata, nextDot, observePeerState } from "./storage/metadata.js";
import { emptySchema, ensureTablesForSchema, mergeSchemas, parseSchemaStatements } from "./storage/schema.js";
import { materializeRow, rowHasVisiblePrimaryKey, setCells, setTombstone } from "./storage/row.js";
import type { ColumnSchema, EngineSnapshot, PeerState, Scalar, SchemaState, TableSchema } from "./storage/types.js";

export interface EngineOptions {
  uniquePolicy?: UniqueConstraintPolicy;
  foreignKeyPolicy?: ForeignKeyPolicy;
}

export interface MutationResult {
  rowsAffected: number;
}

export interface SelectResult {
  rows: Array<Record<string, Scalar>>;
}

export type ExecuteResult = MutationResult | SelectResult;

export class LocalFirstEngine {
  private readonly peers = new Map<string, PeerState>();
  private readonly uniquePolicy: UniqueConstraintPolicy;
  private readonly foreignKeyPolicy: ForeignKeyPolicy;

  constructor(options: EngineOptions = {}) {
    this.uniquePolicy = options.uniquePolicy ?? new DefaultUniqueConstraintPolicy();
    this.foreignKeyPolicy = options.foreignKeyPolicy ?? new DefaultForeignKeyPolicy("tombstone");
  }

  openPeer(peerId: string): PeerState {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const peer: PeerState = {
      peerId,
      schema: emptySchema(),
      tables: {},
      clock: 0,
      writerSummary: {},
      unique: emptyUniqueReservationStore()
    };
    this.peers.set(peerId, peer);
    return peer;
  }

  applySchema(peerId: string, stmts: string | string[]): void {
    const peer = this.getPeer(peerId);
    const parsed = parseSchemaStatements(stmts);
    peer.schema = mergeSchemas(peer.schema, parsed);
    ensureTablesForSchema(peer.tables, peer.schema);
    this.reconcile(peer);
  }

  execute(peerId: string, sql: string, params: readonly Scalar[] = []): ExecuteResult {
    const peer = this.getPeer(peerId);
    const statement = parseSql(sql, params);

    switch (statement.type) {
      case "insert":
        return this.insert(peer, statement);
      case "update":
        return this.update(peer, statement);
      case "delete":
        return this.delete(peer, statement);
      case "select":
        return { rows: selectRows(peer, statement) };
    }
  }

  sync(peerA: string, peerB: string): SyncStats {
    const a = this.getPeer(peerA);
    const b = this.getPeer(peerB);
    return syncPeerStates(a, b, {
      uniquePolicy: this.uniquePolicy,
      foreignKeyPolicy: this.foreignKeyPolicy
    });
  }

  snapshotHash(peerId: string): string {
    return hashCanonical(this.snapshotTables(peerId));
  }

  snapshotHashInternal(peerId: string): string {
    return hashSnapshot(this.replicatedSnapshot(this.getPeer(peerId)));
  }

  snapshotTables(peerId: string): Record<string, Array<Record<string, Scalar>>> {
    const peer = this.getPeer(peerId);
    const tables: Record<string, Array<Record<string, Scalar>>> = {};
    for (const tableName of Object.keys(peer.schema.tables).sort()) {
      const schema = peer.schema.tables[tableName]!;
      tables[tableName] = selectRows(peer, {
        type: "select",
        table: tableName,
        columns: "*",
        conditions: [],
        orderBy: [{ column: schema.primaryKey, direction: "asc" }]
      });
    }
    return tables;
  }

  snapshotState(peerId: string): EngineSnapshot {
    const peer = this.getPeer(peerId);
    const snapshot: EngineSnapshot = {
      peerId: peer.peerId,
      clock: peer.clock,
      schema: peer.schema,
      tables: peer.tables,
      indexes: deriveIndexes(peer),
      unique: peer.unique,
      metadata: {
        writerSummary: peer.writerSummary,
        compacted: true
      }
    };
    return canonicalize(snapshot) as EngineSnapshot;
  }

  close(): void {
    this.peers.clear();
  }

  private insert(peer: PeerState, statement: InsertStatement): MutationResult {
    const schema = this.requireTable(peer.schema, statement.table);
    const table = this.requireTableState(peer, statement.table);
    const values = this.fillInsertDefaults(schema, statement.values);
    const primaryKey = String(values[schema.primaryKey]);
    const existing = table.rows[primaryKey];
    if (existing && rowHasVisiblePrimaryKey(existing, schema)) {
      throw new Error(`Primary key already exists: ${statement.table}.${primaryKey}`);
    }

    const dot = nextDot(peer);
    table.rows[primaryKey] = setCells(existing, values, dot);
    this.reconcile(peer);
    return { rowsAffected: 1 };
  }

  private update(peer: PeerState, statement: UpdateStatement): MutationResult {
    const schema = this.requireTable(peer.schema, statement.table);
    const table = this.requireTableState(peer, statement.table);
    const assignments = this.validateAssignments(schema, statement.assignments);
    const matches = visibleRowsForConditions(peer, statement.table, statement.conditions);
    if (matches.length === 0) return { rowsAffected: 0 };

    const dot = nextDot(peer);
    for (const match of matches) {
      table.rows[match.primaryKey] = setCells(table.rows[match.primaryKey], assignments, dot);
    }
    this.reconcile(peer);
    return { rowsAffected: matches.length };
  }

  private delete(peer: PeerState, statement: DeleteStatement): MutationResult {
    const table = this.requireTableState(peer, statement.table);
    const matches = visibleRowsForConditions(peer, statement.table, statement.conditions);
    if (matches.length === 0) return { rowsAffected: 0 };

    const dot = nextDot(peer);
    for (const match of matches) {
      table.rows[match.primaryKey] = setTombstone(table.rows[match.primaryKey], {
        dot,
        reason: "delete"
      });
    }
    this.reconcile(peer);
    return { rowsAffected: matches.length };
  }

  private reconcile(peer: PeerState): void {
    this.foreignKeyPolicy.apply(peer);
    observePeerState(peer);
    compactMetadata(peer);
    peer.unique = this.uniquePolicy.rebuild(peer.schema, peer.tables);
  }

  private fillInsertDefaults(schema: TableSchema, raw: Record<string, Scalar>): Record<string, Scalar> {
    const values: Record<string, Scalar> = {};
    for (const columnName of schema.columnOrder) {
      const column = schema.columns[columnName]!;
      const value = raw[columnName] ?? column.defaultValue ?? null;
      this.validateColumnValue(column, value);
      values[columnName] = value;
    }
    return values;
  }

  private validateAssignments(schema: TableSchema, raw: Record<string, Scalar>): Record<string, Scalar> {
    const values: Record<string, Scalar> = {};
    for (const [columnName, value] of Object.entries(raw)) {
      if (columnName === schema.primaryKey) throw new Error("Primary key updates are not supported");
      const column = schema.columns[columnName];
      if (!column) throw new Error(`Unknown column: ${schema.name}.${columnName}`);
      this.validateColumnValue(column, value);
      values[columnName] = value;
    }
    return values;
  }

  private validateColumnValue(column: ColumnSchema, value: Scalar): void {
    if (column.notNull && value === null) throw new Error(`Column ${column.name} cannot be null`);
    if (value === null) return;
    if (column.type === "INTEGER" && !Number.isInteger(value)) {
      throw new Error(`Column ${column.name} expects INTEGER`);
    }
    if (column.type === "TEXT" && typeof value !== "string") {
      throw new Error(`Column ${column.name} expects TEXT`);
    }
  }

  private requireTable(schema: SchemaState, tableName: string): TableSchema {
    const table = schema.tables[tableName];
    if (!table) throw new Error(`Unknown table: ${tableName}`);
    return table;
  }

  private requireTableState(peer: PeerState, tableName: string): PeerState["tables"][string] {
    this.requireTable(peer.schema, tableName);
    peer.tables[tableName] ??= { rows: {} };
    return peer.tables[tableName]!;
  }

  private getPeer(peerId: string): PeerState {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Peer is not open: ${peerId}`);
    return peer;
  }

  private replicatedSnapshot(peer: PeerState): Omit<EngineSnapshot, "peerId" | "clock"> {
    const snapshot = this.snapshotState(peer.peerId);
    return {
      schema: snapshot.schema,
      tables: snapshot.tables,
      indexes: snapshot.indexes,
      unique: snapshot.unique,
      metadata: snapshot.metadata
    };
  }
}

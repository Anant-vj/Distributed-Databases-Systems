import type { UniqueReservationStore } from "../policies/unique.js";

export type Scalar = string | number | null;

export interface Dot {
  peerId: string;
  counter: number;
}

export interface CellState {
  value: Scalar;
  dot: Dot;
}

export type TombstoneReason = "delete" | "fk-cascade" | "fk-tombstone";

export interface TombstoneState {
  dot: Dot;
  reason: TombstoneReason;
}

export interface RowState {
  cells: Record<string, CellState>;
  tombstone?: TombstoneState;
}

export interface TableState {
  rows: Record<string, RowState>;
}

export interface ForeignKeyReference {
  table: string;
  column: string;
  onDelete: "cascade";
}

export interface ColumnSchema {
  name: string;
  type: "TEXT" | "INTEGER";
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  defaultValue?: Scalar;
  references?: ForeignKeyReference;
}

export interface TableSchema {
  name: string;
  primaryKey: string;
  columnOrder: string[];
  columns: Record<string, ColumnSchema>;
}

export interface IndexSchema {
  name: string;
  table: string;
  columns: string[];
}

export interface SchemaState {
  tables: Record<string, TableSchema>;
  indexes: Record<string, IndexSchema>;
}

export type WriterSummary = Record<string, number>;

export interface PeerState {
  peerId: string;
  schema: SchemaState;
  tables: Record<string, TableState>;
  clock: number;
  writerSummary: WriterSummary;
  unique: UniqueReservationStore;
}

export interface EngineSnapshot {
  peerId: string;
  clock: number;
  schema: SchemaState;
  tables: Record<string, TableState>;
  indexes: unknown;
  unique: UniqueReservationStore;
  metadata: {
    writerSummary: WriterSummary;
    compacted: boolean;
  };
}

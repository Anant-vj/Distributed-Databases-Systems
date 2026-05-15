import type { IndexSchema, SchemaState, TableSchema, TableState } from "./types.js";

export const emptySchema = (): SchemaState => ({ tables: {}, indexes: {} });

export const referenceUsersTable: TableSchema = {
  name: "users",
  primaryKey: "id",
  columnOrder: ["id", "email", "name"],
  columns: {
    id: { name: "id", type: "TEXT", primaryKey: true, notNull: true },
    email: { name: "email", type: "TEXT", notNull: true, unique: true },
    name: { name: "name", type: "TEXT" }
  }
};

export const referenceOrdersTable: TableSchema = {
  name: "orders",
  primaryKey: "id",
  columnOrder: ["id", "user_id", "status", "total_cents"],
  columns: {
    id: { name: "id", type: "TEXT", primaryKey: true, notNull: true },
    user_id: {
      name: "user_id",
      type: "TEXT",
      notNull: true,
      references: { table: "users", column: "id", onDelete: "cascade" }
    },
    status: { name: "status", type: "TEXT", notNull: true },
    total_cents: { name: "total_cents", type: "INTEGER", notNull: true, defaultValue: 0 }
  }
};

export const referenceOrdersByUserIndex: IndexSchema = {
  name: "orders_by_user",
  table: "orders",
  columns: ["user_id", "status"]
};

export function referenceSchema(): SchemaState {
  return {
    tables: {
      users: structuredClone(referenceUsersTable),
      orders: structuredClone(referenceOrdersTable)
    },
    indexes: {
      orders_by_user: structuredClone(referenceOrdersByUserIndex)
    }
  };
}

export function parseSchemaStatements(stmts: string | string[]): SchemaState {
  const parsed = emptySchema();
  const statements = Array.isArray(stmts)
    ? stmts
    : stmts
        .split(";")
        .map((stmt) => stmt.trim())
        .filter(Boolean);

  for (const raw of statements) {
    const stmt = raw.trim().replace(/;$/, "");
    if (/^create\s+table\s+users\b/i.test(stmt)) {
      parsed.tables.users = structuredClone(referenceUsersTable);
      continue;
    }
    if (/^create\s+table\s+orders\b/i.test(stmt)) {
      parsed.tables.orders = structuredClone(referenceOrdersTable);
      continue;
    }

    const index = stmt.match(/^create\s+index\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)$/i);
    if (index) {
      const [, name, table, columnsRaw] = index;
      parsed.indexes[name!] = {
        name: name!,
        table: table!,
        columns: columnsRaw!.split(",").map((part) => part.trim())
      };
      continue;
    }

    throw new Error(`Unsupported schema statement: ${stmt}`);
  }

  return parsed;
}

export function mergeSchemas(a: SchemaState, b: SchemaState): SchemaState {
  const next = emptySchema();
  for (const table of Object.keys({ ...a.tables, ...b.tables }).sort()) {
    const left = a.tables[table];
    const right = b.tables[table];
    next.tables[table] = structuredClone(right ?? left!);
  }
  for (const index of Object.keys({ ...a.indexes, ...b.indexes }).sort()) {
    const left = a.indexes[index];
    const right = b.indexes[index];
    next.indexes[index] = structuredClone(right ?? left!);
  }
  return next;
}

export function ensureTablesForSchema(
  tables: Record<string, TableState>,
  schema: SchemaState
): void {
  for (const tableName of Object.keys(schema.tables)) {
    tables[tableName] ??= { rows: {} };
  }
}

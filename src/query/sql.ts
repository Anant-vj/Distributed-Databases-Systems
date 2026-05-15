import type { Scalar } from "../storage/types.js";

export interface Condition {
  column: string;
  value: Scalar;
}

export interface OrderBy {
  column: string;
  direction: "asc" | "desc";
}

export interface InsertStatement {
  type: "insert";
  table: string;
  values: Record<string, Scalar>;
}

export interface UpdateStatement {
  type: "update";
  table: string;
  assignments: Record<string, Scalar>;
  conditions: Condition[];
}

export interface DeleteStatement {
  type: "delete";
  table: string;
  conditions: Condition[];
}

export interface SelectStatement {
  type: "select";
  table: string;
  columns: string[] | "*";
  conditions: Condition[];
  orderBy: OrderBy[];
}

export type SqlStatement = InsertStatement | UpdateStatement | DeleteStatement | SelectStatement;

export function parseSql(sql: string, params: readonly Scalar[] = []): SqlStatement {
  const normalized = sql.trim().replace(/;$/, "").replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  const cursor = { index: 0 };

  if (lower.startsWith("insert ")) return parseInsert(normalized, params, cursor);
  if (lower.startsWith("update ")) return parseUpdate(normalized, params, cursor);
  if (lower.startsWith("delete ")) return parseDelete(normalized, params, cursor);
  if (lower.startsWith("select ")) return parseSelect(normalized, params, cursor);

  throw new Error(`Unsupported SQL: ${sql}`);
}

function parseInsert(sql: string, params: readonly Scalar[], cursor: { index: number }): InsertStatement {
  const match = sql.match(/^insert\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)$/i);
  if (!match) throw new Error(`Unsupported INSERT: ${sql}`);
  const [, table, columnsRaw, valuesRaw] = match;
  const columns = splitComma(columnsRaw!).map(cleanIdentifier);
  const values = splitComma(valuesRaw!).map((token) => parseValue(token, params, cursor));
  if (columns.length !== values.length) throw new Error("INSERT column/value count mismatch");

  const record: Record<string, Scalar> = {};
  columns.forEach((column, index) => {
    record[column] = values[index]!;
  });
  return { type: "insert", table: table!, values: record };
}

function parseUpdate(sql: string, params: readonly Scalar[], cursor: { index: number }): UpdateStatement {
  const match = sql.match(/^update\s+(\w+)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/i);
  if (!match) throw new Error(`Unsupported UPDATE: ${sql}`);
  const [, table, assignmentsRaw, whereRaw] = match;
  const assignments: Record<string, Scalar> = {};
  for (const part of splitComma(assignmentsRaw!)) {
    const assignment = part.match(/^(\w+)\s*=\s*(.+)$/i);
    if (!assignment) throw new Error(`Unsupported UPDATE assignment: ${part}`);
    assignments[cleanIdentifier(assignment[1]!)] = parseValue(assignment[2]!, params, cursor);
  }
  return {
    type: "update",
    table: table!,
    assignments,
    conditions: whereRaw ? parseConditions(whereRaw, params, cursor) : []
  };
}

function parseDelete(sql: string, params: readonly Scalar[], cursor: { index: number }): DeleteStatement {
  const match = sql.match(/^delete\s+from\s+(\w+)(?:\s+where\s+(.+))?$/i);
  if (!match) throw new Error(`Unsupported DELETE: ${sql}`);
  const [, table, whereRaw] = match;
  return {
    type: "delete",
    table: table!,
    conditions: whereRaw ? parseConditions(whereRaw, params, cursor) : []
  };
}

function parseSelect(sql: string, params: readonly Scalar[], cursor: { index: number }): SelectStatement {
  const match = sql.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(.+))?$/i);
  if (!match) throw new Error(`Unsupported SELECT: ${sql}`);
  const [, columnsRaw, table, whereRaw, orderRaw] = match;
  const columns = columnsRaw!.trim() === "*" ? "*" : splitComma(columnsRaw!).map(cleanIdentifier);
  return {
    type: "select",
    table: table!,
    columns,
    conditions: whereRaw ? parseConditions(whereRaw, params, cursor) : [],
    orderBy: orderRaw ? parseOrderBy(orderRaw) : []
  };
}

function parseConditions(raw: string, params: readonly Scalar[], cursor: { index: number }): Condition[] {
  return raw.split(/\s+and\s+/i).map((part) => {
    const match = part.trim().match(/^(\w+)\s*=\s*(.+)$/i);
    if (!match) throw new Error(`Unsupported WHERE condition: ${part}`);
    return {
      column: cleanIdentifier(match[1]!),
      value: parseValue(match[2]!, params, cursor)
    };
  });
}

function parseOrderBy(raw: string): OrderBy[] {
  return splitComma(raw).map((part) => {
    const match = part.trim().match(/^(\w+)(?:\s+(asc|desc))?$/i);
    if (!match) throw new Error(`Unsupported ORDER BY term: ${part}`);
    return {
      column: cleanIdentifier(match[1]!),
      direction: (match[2]?.toLowerCase() as "asc" | "desc" | undefined) ?? "asc"
    };
  });
}

function parseValue(token: string, params: readonly Scalar[], cursor: { index: number }): Scalar {
  const trimmed = token.trim();
  if (trimmed === "?") {
    if (cursor.index >= params.length) throw new Error("Not enough SQL parameters");
    return params[cursor.index++]!;
  }
  if (/^null$/i.test(trimmed)) return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  const quoted = trimmed.match(/^'(.*)'$/);
  if (quoted) return quoted[1]!.replace(/''/g, "'");
  throw new Error(`Unsupported SQL value token: ${token}`);
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

function splitComma(raw: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "'") {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (char === "," && !inQuote) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

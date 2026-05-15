import { createEngine as ce } from "../src/adapter.js";
import { DefaultForeignKeyPolicy } from "../src/policies/foreignKeys.js";

function permute(seed: number): Array<[string, string]> {
  const base: Array<[string, string]> = [
    ["A", "B"],
    ["B", "C"],
    ["A", "C"],
    ["A", "B"],
    ["B", "C"],
    ["A", "C"]
  ];
  const rng = mulberry32(seed);
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  return [...base, ["A", "B"], ["B", "C"], ["A", "C"]] as Array<[string, string]>;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCHEMA_STMTS = [
  "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
  "CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, total_cents INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX orders_by_user ON orders(user_id, status)"
];

const OPS: Array<{ kind: "stmt" | "sync"; peer?: string; sql?: string; params?: unknown[]; a?: string; b?: string }> = [
  { kind: "stmt", peer: "A", sql: "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", params: ["u1", "alice@x.com", "Alice"] },
  { kind: "stmt", peer: "A", sql: "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", params: ["u2", "bob@x.com", "Bob"] },
  { kind: "stmt", peer: "B", sql: "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", params: ["u3", "alice@x.com", "Alice2"] },
  { kind: "sync", a: "A", b: "C" },
  { kind: "stmt", peer: "C", sql: "DELETE FROM users WHERE id = ?", params: ["u1"] },
  { kind: "stmt", peer: "A", sql: "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", params: ["o1", "u1", "pending", 1200] },
  { kind: "sync", a: "A", b: "B" },
  { kind: "stmt", peer: "A", sql: "UPDATE users SET name = ? WHERE id = ?", params: ["Alice Cooper", "u1"] },
  { kind: "stmt", peer: "B", sql: "UPDATE users SET email = ? WHERE id = ?", params: ["alice@ex.org", "u1"] }
];

function run(seed: number): string {
  const engine = ce({ foreignKeyPolicy: new DefaultForeignKeyPolicy("tombstone") });
  for (const p of ["A", "B", "C"]) {
    engine.openPeer(p);
    engine.applySchema(p, SCHEMA_STMTS);
  }
  for (const op of OPS) {
    if (op.kind === "stmt") engine.execute(op.peer!, op.sql!, op.params as never);
    else engine.sync(op.a!, op.b!);
  }
  for (const [a, b] of permute(seed)) engine.sync(a, b);
  return engine.snapshotHash("A");
}

console.log("seed1", run(1));
console.log("seed2", run(2));

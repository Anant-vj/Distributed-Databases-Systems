/**
 * Annex A reference scenario — full 3-peer trace with invariant transcript.
 * Run: npm run demo:annex-a
 */
import { createEngine } from "../src/adapter.js";
import { DefaultForeignKeyPolicy } from "../src/policies/foreignKeys.js";

const SCHEMA = [
  "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
  "CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, total_cents INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX orders_by_user ON orders(user_id, status)"
];

const engine = createEngine({
  foreignKeyPolicy: new DefaultForeignKeyPolicy("tombstone")
});

for (const p of ["A", "B", "C"]) {
  engine.openPeer(p);
  engine.applySchema(p, SCHEMA);
}

const steps: Array<{ label: string; run: () => void }> = [
  {
    label: 'A: INSERT users (u1, alice@x.com, "Alice")',
    run: () =>
      engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u1",
        "alice@x.com",
        "Alice"
      ])
  },
  {
    label: 'A: INSERT users (u2, bob@x.com, "Bob")',
    run: () =>
      engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u2",
        "bob@x.com",
        "Bob"
      ])
  },
  {
    label: 'B: INSERT users (u3, alice@x.com, "Alice2")',
    run: () =>
      engine.execute("B", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u3",
        "alice@x.com",
        "Alice2"
      ])
  },
  { label: "Sync A↔C", run: () => engine.sync("A", "C") },
  { label: "C: DELETE users u1", run: () => engine.execute("C", "DELETE FROM users WHERE id = ?", ["u1"]) },
  {
    label: "A: INSERT orders (o1, u1, pending, 1200)",
    run: () =>
      engine.execute(
        "A",
        "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)",
        ["o1", "u1", "pending", 1200]
      )
  },
  { label: "Sync A↔B", run: () => engine.sync("A", "B") },
  {
    label: "A: UPDATE users SET name = 'Alice Cooper' WHERE id = u1",
    run: () => engine.execute("A", "UPDATE users SET name = ? WHERE id = ?", ["Alice Cooper", "u1"])
  },
  {
    label: "B: UPDATE users SET email = 'alice@ex.org' WHERE id = u1",
    run: () => engine.execute("B", "UPDATE users SET email = ? WHERE id = ?", ["alice@ex.org", "u1"])
  }
];

console.log("=== Annex A Reference Scenario (FK policy: tombstone) ===\n");
for (const step of steps) {
  step.run();
  console.log(`✓ ${step.label}`);
}

const finalSync = [
  ["A", "B"],
  ["B", "C"],
  ["A", "C"],
  ["A", "B"],
  ["B", "C"],
  ["A", "C"]
] as const;
for (const [a, b] of finalSync) {
  engine.sync(a, b);
}
console.log("✓ Pairwise sync to quiescence (6 rounds)\n");

const hashes = { A: engine.snapshotHash("A"), B: engine.snapshotHash("B"), C: engine.snapshotHash("C") };
const state = engine.snapshotTables("A");
const snapshot = engine.snapshotState("A");

console.log("--- Convergence ---");
console.log("Hashes:", hashes);
console.log("All peers agree:", new Set(Object.values(hashes)).size === 1);

console.log("\n--- Visible state (peer A) ---");
console.log(JSON.stringify(state, null, 2));

console.log("\n--- Invariant checklist ---");
console.log("• Uniqueness (users.email):", uniqueEmailsOk(state));
console.log("• FK tombstone (o1 survives, u1 not live):", fkTombstoneOk(state));
console.log("• Cell-level u1 (vacuous if tombstoned from SELECT):", cellLevelNote(state));
console.log("• Recoverable uniqueness losers:", snapshot.unique.conflicts.length, "conflict(s)");

engine.close();

function uniqueEmailsOk(tables: Record<string, Array<Record<string, unknown>>>): boolean {
  const emails = (tables.users ?? []).map((u) => u.email).filter(Boolean);
  return emails.length === new Set(emails).size;
}

function fkTombstoneOk(tables: Record<string, Array<Record<string, unknown>>>): boolean {
  const liveUsers = new Set((tables.users ?? []).map((u) => u.id));
  const o1 = (tables.orders ?? []).find((o) => o.id === "o1");
  return Boolean(o1 && o1.user_id === "u1" && !liveUsers.has("u1"));
}

function cellLevelNote(tables: Record<string, Array<Record<string, unknown>>>): string {
  const u1 = (tables.users ?? []).find((u) => u.id === "u1");
  if (!u1) return "u1 not visible (deleted); concurrent cols preserved in CRDT metadata";
  return u1.name === "Alice Cooper" && u1.email === "alice@ex.org"
    ? "both columns visible"
    : `partial: ${JSON.stringify(u1)}`;
}

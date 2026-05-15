import { describe, expect, it } from "vitest";
import { createEngine } from "../adapter.js";
import { referenceSchemaSql, rows } from "./helpers.js";

describe("benchmark reference trace", () => {
  it("executes the Annex A reference scenario and converges", () => {
    const engine = createEngine();
    for (const p of ["A", "B", "C"]) {
      engine.openPeer(p);
      engine.applySchema(p, referenceSchemaSql);
    }

    // 1. Peer A inserts u1 and u2
    engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "alice@x.com", "Alice"]);
    engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u2", "bob@x.com", "Bob"]);

    // 2. Peer B inserts conflicting email u3 (conflicts with u2)
    engine.execute("B", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u3", "bob@x.com", "Alice2"]);

    // 3. Peer C syncs from A
    engine.sync("A", "C");

    // 4. Peer C deletes u1
    engine.execute("C", "DELETE FROM users WHERE id = ?", ["u1"]);

    // 5. Peer A inserts order o1 referencing u1
    engine.execute("A", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", ["o1", "u1", "pending", 1200]);

    // 6. Sync A<->B so B knows about u1 before updating it
    engine.sync("A", "B");

    // 7. Peer A updates u1.name
    engine.execute("A", "UPDATE users SET name = ? WHERE id = ?", ["Alice Cooper", "u1"]);

    // 8. Peer B updates u1.email
    engine.execute("B", "UPDATE users SET email = ? WHERE id = ?", ["alice@ex.org", "u1"]);

    // 9. Sync A<->B, B<->C, A<->C repeatedly until quiescent
    const syncRounds = [
      ["A", "B"], ["B", "C"], ["A", "C"],
      ["A", "B"], ["B", "C"], ["A", "C"]
    ] as const;

    for (const [p1, p2] of syncRounds) {
      engine.sync(p1, p2);
    }

    // Assertions
    const hashA = engine.snapshotHash("A");
    const hashB = engine.snapshotHash("B");
    const hashC = engine.snapshotHash("C");

    const stateA = engine.snapshotState("A");

    // - snapshot hashes identical
    expect(hashA).toEqual(hashB);
    expect(hashB).toEqual(hashC);

    // - convergence stable under repeated sync
    engine.sync("A", "B");
    expect(engine.snapshotHash("A")).toEqual(hashA);

    // - both field updates survive (verified in metadata as u1 is tombstoned)
    const u1Row = stateA.tables.users!.rows.u1!;
    expect(u1Row.tombstone).toBeDefined();
    expect(u1Row.cells.name.value).toBe("Alice Cooper");
    expect(u1Row.cells.email.value).toBe("alice@ex.org");

    // - uniqueness conflict preserved
    // One of them should be a loser. In this implementation, u2 loses to u3 (lower dot counter)
    expect(stateA.unique.conflicts.length).toBeGreaterThan(0);
    const loser = stateA.unique.conflicts[0];
    expect(loser).toBeDefined();
    expect(new Set([loser.winnerPk, loser.loserPk])).toEqual(new Set(["u2", "u3"]));

    // - final state deterministic
    // visible users should not include u1 (deleted) or the conflict loser
    const usersA = rows(engine.execute("A", "SELECT * FROM users"));
    expect(usersA.find(u => u.id === "u1")).toBeUndefined();
    const visibleIds = usersA.map(u => u.id);
    expect(visibleIds).toContain(loser.winnerPk);
    expect(visibleIds).not.toContain(loser.loserPk);

    // visible orders should include o1 (tombstone FK policy)
    const ordersA = rows(engine.execute("A", "SELECT * FROM orders"));
    expect(ordersA.find(o => o.id === "o1")).toBeDefined();
    expect(ordersA.find(o => o.id === "o1")?.user_id).toBe("u1");
  });
});

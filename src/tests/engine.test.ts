import { describe, expect, it } from "vitest";
import { createReadyEngine, referenceSchemaSql, rows } from "./helpers.js";
import { createEngine } from "../adapter.js";

describe("local-first relational engine", () => {
  it("merges concurrent inserts from different peers", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "a@example.test",
      "Ada"
    ]);
    engine.execute("b", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u2",
      "b@example.test",
      "Ben"
    ]);

    engine.sync("a", "b");

    expect(rows(engine.execute("a", "SELECT * FROM users")).map((row) => row.id)).toEqual(["u1", "u2"]);
    expect(engine.snapshotHash("a")).toEqual(engine.snapshotHash("b"));
  });

  it("keeps concurrent updates to different columns of the same row", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "old@example.test",
      "Old Name"
    ]);
    engine.sync("a", "b");

    engine.execute("a", "UPDATE users SET name = ? WHERE id = ?", ["New Name", "u1"]);
    engine.execute("b", "UPDATE users SET email = ? WHERE id = ?", ["new@example.test", "u1"]);
    engine.sync("a", "b");

    expect(rows(engine.execute("a", "SELECT * FROM users WHERE id = ?", ["u1"]))).toEqual([
      { id: "u1", email: "new@example.test", name: "New Name" }
    ]);
  });

  it("resolves delete-parent vs insert-child with cascade tombstone metadata", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "user@example.test",
      "User"
    ]);
    engine.sync("a", "b");

    engine.execute("a", "DELETE FROM users WHERE id = ?", ["u1"]);
    engine.execute("b", "INSERT INTO orders (id, user_id, status) VALUES (?, ?, ?)", [
      "o1",
      "u1",
      "pending"
    ]);
    engine.sync("a", "b");

    expect(rows(engine.execute("a", "SELECT * FROM orders"))).toEqual([]);
    expect(engine.snapshotState("a").tables.orders!.rows.o1!.tombstone?.reason).toBe("fk-cascade");
    expect(engine.snapshotHash("a")).toEqual(engine.snapshotHash("b"));
  });

  it("records uniqueness conflicts as recoverable loser metadata", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "same@example.test",
      "Winner"
    ]);
    engine.execute("b", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u2",
      "same@example.test",
      "Loser"
    ]);

    engine.sync("a", "b");

    const snapshot = engine.snapshotState("a");
    expect(rows(engine.execute("a", "SELECT * FROM users")).map((row) => row.id)).toEqual(["u1"]);
    expect(snapshot.unique.conflicts).toEqual([
      expect.objectContaining({
        table: "users",
        column: "email",
        value: "same@example.test",
        winnerPk: "u1",
        loserPk: "u2",
        recoverable: true
      })
    ]);
    expect(snapshot.tables.users!.rows.u2).toBeDefined();
  });

  it("is independent of pairwise sync order once all peers are connected", () => {
    const makeScenario = () => {
      const engine = createReadyEngine(["a", "b", "c"]);
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u1",
        "a@example.test",
        "Ada"
      ]);
      engine.execute("b", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u2",
        "b@example.test",
        "Ben"
      ]);
      engine.execute("c", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
        "u3",
        "c@example.test",
        "Cy"
      ]);
      return engine;
    };

    const first = makeScenario();
    first.sync("a", "b");
    first.sync("b", "c");
    first.sync("a", "c");

    const second = makeScenario();
    second.sync("b", "c");
    second.sync("a", "c");
    second.sync("a", "b");

    expect(first.snapshotHash("a")).toEqual(second.snapshotHash("a"));
    expect(first.snapshotHash("a")).toEqual(first.snapshotHash("b"));
    expect(second.snapshotHash("a")).toEqual(second.snapshotHash("c"));
  });

  it("makes duplicate sync idempotent", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "a@example.test",
      "Ada"
    ]);

    const first = engine.sync("a", "b");
    const hashAfterFirst = engine.snapshotHash("a");
    const second = engine.sync("a", "b");

    expect(first.rowsMerged).toBe(1);
    expect(second.rowsMerged).toBe(0);
    expect(engine.snapshotHash("a")).toBe(hashAfterFirst);
    expect(engine.snapshotHash("a")).toEqual(engine.snapshotHash("b"));
  });

  it("produces deterministic snapshot hashes", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "a@example.test",
      "Ada"
    ]);
    engine.sync("a", "b");

    expect(engine.snapshotHash("a")).toEqual(engine.snapshotHash("a"));
    expect(engine.snapshotHash("a")).toEqual(engine.snapshotHash("b"));
  });

  it("returns stable index ordering for index-backed reads", () => {
    const engine = createReadyEngine();
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "buyer@example.test",
      "Buyer"
    ]);
    engine.execute("a", "INSERT INTO orders (id, user_id, status) VALUES (?, ?, ?)", [
      "o3",
      "u1",
      "shipped"
    ]);
    engine.execute("a", "INSERT INTO orders (id, user_id, status) VALUES (?, ?, ?)", [
      "o1",
      "u1",
      "pending"
    ]);
    engine.execute("a", "INSERT INTO orders (id, user_id, status) VALUES (?, ?, ?)", [
      "o2",
      "u1",
      "cancelled"
    ]);

    expect(
      rows(engine.execute("a", "SELECT * FROM orders WHERE user_id = ?", ["u1"])).map((row) => row.id)
    ).toEqual(["o2", "o1", "o3"]);
    expect(engine.snapshotState("a").indexes).toEqual({
      orders: {
        orders_by_user: [
          { key: ["u1", "cancelled"], primaryKey: "o2" },
          { key: ["u1", "pending"], primaryKey: "o1" },
          { key: ["u1", "shipped"], primaryKey: "o3" }
        ]
      }
    });
  });

  it("keeps metadata bounded across repeated writes to the same cell", () => {
    const engine = createReadyEngine(["a"]);
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      "u1",
      "a@example.test",
      "v0"
    ]);

    for (let index = 1; index <= 100; index += 1) {
      engine.execute("a", "UPDATE users SET name = ? WHERE id = ?", [`v${index}`, "u1"]);
    }

    const snapshot = engine.snapshotState("a");
    expect(Object.keys(snapshot.tables.users!.rows.u1!.cells)).toEqual(["email", "id", "name"]);
    expect(Object.keys(snapshot.metadata.writerSummary)).toEqual(["a"]);
    expect(JSON.stringify(snapshot.metadata).length).toBeLessThan(100);
  });

  it("accepts the reference schema as one semicolon-delimited string", () => {
    const engine = createEngine();
    engine.openPeer("a");
    engine.applySchema("a", `${referenceSchemaSql.join(";")};`);
    engine.execute("a", "INSERT INTO users (id, email, name) VALUES ('u1', 'a@example.test', 'Ada')");

    expect(rows(engine.execute("a", "SELECT * FROM users"))).toEqual([
      { id: "u1", email: "a@example.test", name: "Ada" }
    ]);
  });
});

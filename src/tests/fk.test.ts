import { describe, expect, it } from "vitest";
import { createEngine } from "../adapter.js";
import { DefaultForeignKeyPolicy } from "../policies/foreignKeys.js";
import { referenceSchemaSql, rows } from "./helpers.js";

describe("Foreign Key Semantics", () => {
  const setup = (policyMode: "cascade" | "tombstone" | "orphan") => {
    const engine = createEngine({
      foreignKeyPolicy: new DefaultForeignKeyPolicy(policyMode)
    });
    for (const peer of ["a", "b"]) {
      engine.openPeer(peer);
      engine.applySchema(peer, referenceSchemaSql);
    }
    return engine;
  };

  describe("Tombstone Policy", () => {
    it("preserves child when parent is deleted concurrently", () => {
      const engine = setup("tombstone");
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "u1@test.com", "User 1"]);
      engine.sync("a", "b");

      // Partition
      engine.execute("a", "DELETE FROM users WHERE id = ?", ["u1"]);
      engine.execute("b", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", ["o1", "u1", "pending", 100]);

      // Heal partition
      engine.sync("a", "b");

      const users = rows(engine.execute("a", "SELECT * FROM users"));
      const orders = rows(engine.execute("a", "SELECT * FROM orders"));

      // Parent is deleted
      expect(users.length).toBe(0);
      // Child survives
      expect(orders.length).toBe(1);
      expect(orders[0]!.id).toBe("o1");
    });
  });

  describe("Cascade Policy", () => {
    it("deletes child when parent is deleted concurrently", () => {
      const engine = setup("cascade");
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "u1@test.com", "User 1"]);
      engine.sync("a", "b");

      // Partition
      engine.execute("a", "DELETE FROM users WHERE id = ?", ["u1"]);
      engine.execute("b", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", ["o1", "u1", "pending", 100]);

      // Heal partition
      engine.sync("a", "b");

      const users = rows(engine.execute("a", "SELECT * FROM users"));
      const orders = rows(engine.execute("a", "SELECT * FROM orders"));

      // Parent is deleted
      expect(users.length).toBe(0);
      // Child is cascaded (deleted)
      expect(orders.length).toBe(0);
    });
  });

  describe("Orphan Policy", () => {
    it("preserves child but leaves it orphaned", () => {
      const engine = setup("orphan");
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "u1@test.com", "User 1"]);
      engine.sync("a", "b");

      // Partition
      engine.execute("a", "DELETE FROM users WHERE id = ?", ["u1"]);
      engine.execute("b", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", ["o1", "u1", "pending", 100]);

      // Heal partition
      engine.sync("a", "b");

      const users = rows(engine.execute("a", "SELECT * FROM users"));
      const orders = rows(engine.execute("a", "SELECT * FROM orders"));

      // Parent is deleted
      expect(users.length).toBe(0);
      // Child survives
      expect(orders.length).toBe(1);
      expect(orders[0]!.id).toBe("o1");
    });
  });
});

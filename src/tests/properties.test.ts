import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createReadyEngine, rows } from "./helpers.js";
import { mergeCell, mergeRow, mergeTable } from "../merge/merge.js";
import { canonicalSerialize } from "../serialize/canonical.js";
import type { CellState, RowState, Scalar, TableState, TombstoneState, Dot } from "../storage/types.js";

const fcScalar = fc.oneof(fc.string(), fc.integer(), fc.constant(null));
const fcDot = fc.record<Dot>({ peerId: fc.string(), counter: fc.integer() });

const fcCellState = fc.record<CellState>({
  value: fcScalar,
  dot: fcDot,
});

const fcTombstoneState = fc.record<TombstoneState>({
  dot: fcDot,
  reason: fc.constantFrom("delete", "fk-cascade", "fk-tombstone"),
});

const fcRowState = fc.record<RowState>({
  cells: fc.dictionary(fc.string({ minLength: 1 }), fcCellState),
  tombstone: fc.option(fcTombstoneState, { nil: undefined }),
});

const fcTableState = fc.record<TableState>({
  rows: fc.dictionary(fc.string({ minLength: 1 }), fcRowState),
});

describe("merge properties - formal verification", () => {
  describe("1. COMMUTATIVITY", () => {
    it("mergeCell(a, b) == mergeCell(b, a)", () => {
      fc.assert(
        fc.property(fc.option(fcCellState, { nil: undefined }), fc.option(fcCellState, { nil: undefined }), (a, b) => {
          expect(canonicalSerialize(mergeCell(a, b))).toBe(canonicalSerialize(mergeCell(b, a)));
        })
      );
    });

    it("mergeRow(a, b) == mergeRow(b, a)", () => {
      fc.assert(
        fc.property(fc.option(fcRowState, { nil: undefined }), fc.option(fcRowState, { nil: undefined }), (a, b) => {
          expect(canonicalSerialize(mergeRow(a, b))).toBe(canonicalSerialize(mergeRow(b, a)));
        })
      );
    });

    it("mergeTable(a, b) == mergeTable(b, a)", () => {
      fc.assert(
        fc.property(fc.option(fcTableState, { nil: undefined }), fc.option(fcTableState, { nil: undefined }), (a, b) => {
          expect(canonicalSerialize(mergeTable(a, b))).toBe(canonicalSerialize(mergeTable(b, a)));
        })
      );
    });
  });

  describe("2. ASSOCIATIVITY", () => {
    it("mergeCell(mergeCell(a, b), c) == mergeCell(a, mergeCell(b, c))", () => {
      fc.assert(
        fc.property(
          fc.option(fcCellState, { nil: undefined }),
          fc.option(fcCellState, { nil: undefined }),
          fc.option(fcCellState, { nil: undefined }),
          (a, b, c) => {
            const left = mergeCell(mergeCell(a, b), c);
            const right = mergeCell(a, mergeCell(b, c));
            expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
          }
        )
      );
    });

    it("mergeRow(mergeRow(a, b), c) == mergeRow(a, mergeRow(b, c))", () => {
      fc.assert(
        fc.property(
          fc.option(fcRowState, { nil: undefined }),
          fc.option(fcRowState, { nil: undefined }),
          fc.option(fcRowState, { nil: undefined }),
          (a, b, c) => {
            const left = mergeRow(mergeRow(a, b), c);
            const right = mergeRow(a, mergeRow(b, c));
            expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
          }
        )
      );
    });

    it("mergeTable(mergeTable(a, b), c) == mergeTable(a, mergeTable(b, c))", () => {
      fc.assert(
        fc.property(
          fc.option(fcTableState, { nil: undefined }),
          fc.option(fcTableState, { nil: undefined }),
          fc.option(fcTableState, { nil: undefined }),
          (a, b, c) => {
            const left = mergeTable(mergeTable(a, b), c);
            const right = mergeTable(a, mergeTable(b, c));
            expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
          }
        )
      );
    });
  });

  describe("3. IDEMPOTENCE", () => {
    it("mergeCell(a, a) == a", () => {
      fc.assert(
        fc.property(fc.option(fcCellState, { nil: undefined }), (a) => {
          expect(canonicalSerialize(mergeCell(a, a))).toBe(canonicalSerialize(a));
        })
      );
    });

    it("mergeRow(a, a) == a", () => {
      fc.assert(
        fc.property(fc.option(fcRowState, { nil: undefined }), (a) => {
          expect(canonicalSerialize(mergeRow(a, a))).toBe(canonicalSerialize(a));
        })
      );
    });

    it("mergeTable(a, a) == a", () => {
      fc.assert(
        fc.property(fc.option(fcTableState, { nil: undefined }), (a) => {
          expect(canonicalSerialize(mergeTable(a, a))).toBe(canonicalSerialize(a ?? { rows: {} }));
        })
      );
    });
  });

  describe("4. SYNC IDEMPOTENCE", () => {
    it("repeated syncs must not change converged state", () => {
      const engine = createReadyEngine(["a", "b"]);
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "u1@example.com", "U1"]);
      engine.execute("b", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u2", "u2@example.com", "U2"]);

      engine.sync("a", "b");
      const hash1 = engine.snapshotHash("a");

      // Sync again
      engine.sync("a", "b");
      const hash2 = engine.snapshotHash("a");

      expect(hash1).toBe(hash2);
    });
  });

  describe("5. SYNC ORDER INDEPENDENCE", () => {
    it("different pairwise sync orders produce identical snapshot hashes", () => {
      fc.assert(
        fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 20 }), (ids) => {
          const populate = () => {
            const engine = createReadyEngine(["a", "b", "c"]);
            ids.forEach((id, index) => {
              const peer = index % 3 === 0 ? "a" : index % 3 === 1 ? "b" : "c";
              engine.execute(peer, "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
                `u${id}`,
                `u${id}@example.test`,
                `User ${id}`
              ]);
            });
            return engine;
          };

          const left = populate();
          left.sync("a", "b");
          left.sync("b", "c");
          left.sync("a", "c");

          const right = populate();
          right.sync("b", "c");
          right.sync("a", "c");
          right.sync("a", "b");

          expect(left.snapshotHash("a")).toBe(right.snapshotHash("a"));
          expect(left.snapshotHash("a")).toBe(left.snapshotHash("b"));
          expect(left.snapshotHash("a")).toBe(left.snapshotHash("c"));
        })
      );
    });
  });

  describe("7. CELL-LEVEL CONVERGENCE", () => {
    it("concurrent updates to different columns of the same row must both survive", () => {
      const engine = createReadyEngine(["a", "b"]);
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "old@ex.com", "Old"]);
      engine.sync("a", "b");

      engine.execute("a", "UPDATE users SET name = ? WHERE id = ?", ["New", "u1"]);
      engine.execute("b", "UPDATE users SET email = ? WHERE id = ?", ["new@ex.com", "u1"]);

      engine.sync("a", "b");

      const res = rows(engine.execute("a", "SELECT * FROM users WHERE id = ?", ["u1"]));
      expect(res.length).toBe(1);
      expect(res[0]!.name).toBe("New");
      expect(res[0]!.email).toBe("new@ex.com");
    });
  });

  describe("10. TOMBSTONE VISIBILITY", () => {
    it("deleted rows must not accidentally resurrect due to stale updates", () => {
      const engine = createReadyEngine(["a", "b"]);
      engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", ["u1", "old@ex.com", "Old"]);
      engine.sync("a", "b");

      // Peer a deletes
      engine.execute("a", "DELETE FROM users WHERE id = ?", ["u1"]);
      
      // Peer b updates concurrently
      engine.execute("b", "UPDATE users SET name = ? WHERE id = ?", ["Stale Name", "u1"]);

      engine.sync("a", "b");

      const res = rows(engine.execute("a", "SELECT * FROM users WHERE id = ?", ["u1"]));
      expect(res.length).toBe(0); // Should remain hidden
    });
  });
});

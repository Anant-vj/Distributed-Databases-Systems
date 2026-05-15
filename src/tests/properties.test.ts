import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createReadyEngine } from "./helpers.js";

describe("merge properties", () => {
  it("converges to the same hash regardless of pairwise sync direction", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 20 }), (ids) => {
        const populate = () => {
          const engine = createReadyEngine();
          ids.forEach((id, index) => {
            const peer = index % 2 === 0 ? "a" : "b";
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

        const right = populate();
        right.sync("b", "a");

        expect(left.snapshotHash("a")).toBe(right.snapshotHash("a"));
        expect(left.snapshotHash("a")).toBe(left.snapshotHash("b"));
        expect(right.snapshotHash("a")).toBe(right.snapshotHash("b"));
      })
    );
  });
});

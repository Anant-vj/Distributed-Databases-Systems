import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalSerialize, hashCanonical } from "../serialize/stable.js";

describe("deterministic hashing and serialization", () => {
  it("produces identical serialization for objects with differently ordered keys", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.constant(null))),
        (dict) => {
          const keys = Object.keys(dict);
          if (keys.length < 2) return;

          // Create an object with normal insertion order
          const obj1: Record<string, unknown> = {};
          for (const k of keys) obj1[k] = dict[k];

          // Create an object with reversed insertion order
          const obj2: Record<string, unknown> = {};
          for (const k of [...keys].reverse()) obj2[k] = dict[k];

          expect(canonicalSerialize(obj1)).toBe(canonicalSerialize(obj2));
          expect(hashCanonical(obj1)).toBe(hashCanonical(obj2));
        }
      )
    );
  });

  it("produces identical serialization for deeply nested objects with differently ordered keys", () => {
    const obj1 = {
      a: 1,
      b: { z: 9, y: 8, x: { c: 3, a: 1 } },
      c: [ { b: 2, a: 1 }, { d: 4, c: 3 } ]
    };

    const obj2 = {
      c: [ { a: 1, b: 2 }, { c: 3, d: 4 } ],
      b: { x: { a: 1, c: 3 }, y: 8, z: 9 },
      a: 1
    };

    expect(canonicalSerialize(obj1)).toBe(canonicalSerialize(obj2));
    expect(hashCanonical(obj1)).toBe(hashCanonical(obj2));
  });

  it("maintains strict array ordering (does not sort arrays)", () => {
    // Array sorting is the responsibility of the caller (e.g., merge logic sorting by rowId)
    // The canonical serializer should NOT automatically sort arrays, as it would destroy semantic order.
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];

    expect(canonicalSerialize(arr1)).not.toBe(canonicalSerialize(arr2));
  });
});

import { createHash } from "node:crypto";
import type { Scalar } from "../storage/types.js";

export function sortedKeys<T extends object>(value: T): Array<keyof T & string> {
  return Object.keys(value).sort() as Array<keyof T & string>;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareScalars(a: Scalar, b: Scalar): number {
  const rank = (value: Scalar): number => {
    if (value === null) return 0;
    if (typeof value === "number") return 1;
    return 2;
  };
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return compareStrings(String(a), String(b));
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value === null || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) result[key] = canonicalize(child);
  }
  return result;
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value)).digest("hex");
}

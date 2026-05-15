import type { Dot } from "../storage/types.js";

export function compareDots(a: Dot, b: Dot): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0;
}

export function maxDot(a: Dot | undefined, b: Dot | undefined): Dot | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  return compareDots(a, b) >= 0 ? { ...a } : { ...b };
}

export function cloneDot(dot: Dot): Dot {
  return { peerId: dot.peerId, counter: dot.counter };
}

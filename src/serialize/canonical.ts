import { canonicalSerialize, hashCanonical } from "./stable.js";

export { canonicalSerialize };

export function snapshotHash(state: unknown): string {
  return hashCanonical(state);
}

import { createEngine, type LocalFirstEngine } from "../adapter.js";
import type { SelectResult } from "../engine.js";

export const referenceSchemaSql = [
  "CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
  "CREATE TABLE orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, total_cents INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX orders_by_user ON orders(user_id, status)"
];

export function createReadyEngine(peers: string[] = ["a", "b"]): LocalFirstEngine {
  const engine = createEngine();
  for (const peer of peers) {
    engine.openPeer(peer);
    engine.applySchema(peer, referenceSchemaSql);
  }
  return engine;
}

export function rows(result: unknown): SelectResult["rows"] {
  return (result as SelectResult).rows;
}

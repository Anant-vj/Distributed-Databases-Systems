# Anvil Local-First Relational Engine

A judged-hackathon prototype for a local-first relational engine with CRDT-style replication over the reference schema.

The authoritative state is pure in-memory CRDT state:

- `table -> primary key -> row state`
- each row stores per-cell value metadata
- row deletion is represented with explicit tombstones
- indexes and uniqueness reservations are derived from row state
- sync is peer-to-peer and bidirectional, with no coordinator or server source of truth

## Commands

```bash
pnpm install
pnpm test
pnpm demo
pnpm build
```

## Public API

```ts
import { createEngine } from "./src/index.js";

const engine = createEngine();
engine.openPeer("a");
engine.applySchema("a", [
  "CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
  "CREATE TABLE orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, total_cents INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX orders_by_user ON orders(user_id, status)"
]);

engine.execute("a", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
  "u1",
  "ada@example.test",
  "Ada"
]);
```

Methods:

- `openPeer(peerId)`
- `applySchema(peerId, stmts)`
- `execute(peerId, sql, params)`
- `sync(peerA, peerB)`
- `snapshotHash(peerId)`
- `snapshotState(peerId)`
- `close()`

## Merge Model

Merges are pure, deterministic, commutative, associative, and idempotent at the row/cell level. Concurrent updates to different columns of the same row survive because each cell carries its own causal dot. Row deletes use tombstones instead of removing storage.

Same-cell conflicts use deterministic dot ordering and then canonical value ordering as the final tie-breaker. This is intentionally cell-level, not whole-row LWW.

## Extension Points

Uniqueness plugs in at [src/policies/unique.ts](src/policies/unique.ts). The engine talks to `UniqueConstraintPolicy`, and the current `DefaultUniqueConstraintPolicy` rebuilds a derived reservation store with recoverable loser conflict records. Row storage does not know about unique constraints.

Foreign keys plug in at [src/policies/foreignKeys.ts](src/policies/foreignKeys.ts). The engine invokes a `ForeignKeyPolicy` from one reconciliation point. The default mode is `cascade`; `tombstone` and `orphan` are available modes for later policy experiments.

Deterministic hashing lives in [src/serialize](src/serialize). `canonicalSerialize(state)` and `snapshotHash(state)` are centralized so hashing and canonical ordering do not leak through the engine.

Metadata bounds live in [src/storage/metadata.ts](src/storage/metadata.ts). The current implementation stores one causal dot per cell/tombstone plus a compact writer summary. There is no operation log, so repeated writes to the same cell replace metadata rather than appending per-write history.

Schema parsing is deliberately narrow and lives in [src/storage/schema.ts](src/storage/schema.ts). Future migration support can extend `SchemaState` and `mergeSchemas` without changing row merge behavior.

## SQL Surface

This is not a general SQL database. It supports the benchmark subset:

- `CREATE TABLE` for `users` and `orders`
- `CREATE INDEX`
- `INSERT`
- `UPDATE`
- `DELETE`
- `SELECT` with simple equality predicates and deterministic ordering

SQLite is not used as authoritative storage.

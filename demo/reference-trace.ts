import { createEngine } from "../src/adapter.js";
import { referenceSchemaSql } from "../src/tests/helpers.js";

const engine = createEngine();

for (const peer of ["alpha", "beta"]) {
  engine.openPeer(peer);
  engine.applySchema(peer, referenceSchemaSql);
}

engine.execute("alpha", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
  "u1",
  "ada@example.test",
  "Ada"
]);
engine.sync("alpha", "beta");

engine.execute("alpha", "UPDATE users SET name = ? WHERE id = ?", ["Ada Lovelace", "u1"]);
engine.execute("beta", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", [
  "o1",
  "u1",
  "pending",
  4200
]);
engine.sync("alpha", "beta");

console.log("alpha hash", engine.snapshotHash("alpha"));
console.log("beta hash ", engine.snapshotHash("beta"));
console.log(
  JSON.stringify(
    {
      users: engine.execute("alpha", "SELECT * FROM users"),
      orders: engine.execute("alpha", "SELECT * FROM orders WHERE user_id = ?", ["u1"]),
      uniqueConflicts: engine.snapshotState("alpha").unique.conflicts
    },
    null,
    2
  )
);

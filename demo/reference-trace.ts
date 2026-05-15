import { createEngine } from "../src/adapter.js";
import { referenceSchemaSql } from "../src/tests/helpers.js";

const engine = createEngine();

const wait = () => new Promise(resolve => setTimeout(resolve, 1000));

async function runDemo() {
  console.log("=== INITIALIZATION ===");
  for (const peer of ["A", "B", "C"]) {
    engine.openPeer(peer);
    engine.applySchema(peer, referenceSchemaSql);
    console.log(`[${peer}] Peer initialized with reference schema`);
  }
  await wait();

  console.log("\n=== DISCONNECTED WRITES ===");
  engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
    "u1",
    "ada@example.test",
    "Ada"
  ]);
  console.log("[A] Inserted user u1 (Ada)");
  
  // Distribute u1 so other peers can update it
  engine.sync("A", "B");
  engine.sync("A", "C");
  console.log("[SYNC] User u1 replicated to all peers");
  await wait();

  console.log("\n=== CELL MERGE (CONCURRENT UPDATES) ===");
  engine.execute("A", "UPDATE users SET name = ? WHERE id = ?", ["Ada Lovelace", "u1"]);
  console.log("[A] Updated u1 name to 'Ada Lovelace'");
  engine.execute("B", "UPDATE users SET email = ? WHERE id = ?", ["ada.l@example.test", "u1"]);
  console.log("[B] Updated u1 email to 'ada.l@example.test'");
  console.log("Note: A and B have updated different columns of the same row while disconnected.");
  await wait();

  console.log("\n=== UNIQUENESS CONFLICT ===");
  engine.execute("C", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
    "u2",
    "ada.l@example.test",
    "Imposter Ada"
  ]);
  console.log("[C] Inserted user u2 with email 'ada.l@example.test' (conflicts with B's pending update)");
  await wait();

  console.log("\n=== FK CONFLICT (DELETE VS CHILD INSERT) ===");
  engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
    "u3",
    "bob@example.test",
    "Bob"
  ]);
  engine.sync("A", "B");
  console.log("[SYNC] A and B synced u3");
  
  engine.execute("A", "DELETE FROM users WHERE id = ?", ["u3"]);
  console.log("[A] Deleted user u3 (Bob)");
  engine.execute("B", "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", [
    "o1",
    "u3",
    "pending",
    5000
  ]);
  console.log("[B] Inserted order o1 for user u3 (Bob) concurrently with deletion");
  await wait();

  console.log("\n=== SYNC PHASE ===");
  console.log("[SYNC] Synchronizing all peers to convergence...");
  engine.sync("A", "B");
  engine.sync("B", "C");
  engine.sync("A", "C");
  engine.sync("A", "B"); // Extra round to ensure full propagation
  await wait();

  console.log("\n=== FINAL STATE (Peer A) ===");
  const users = engine.execute("A", "SELECT * FROM users");
  const orders = engine.execute("A", "SELECT * FROM orders");
  const conflicts = engine.snapshotState("A").unique.conflicts;

  console.log("Users:", JSON.stringify(users.rows, null, 2));
  console.log("Orders:", JSON.stringify(orders.rows, null, 2));
  console.log("Uniqueness Conflicts:", JSON.stringify(conflicts, null, 2));
  await wait();

  console.log("\n=== HASH COMPARISON ===");
  const hashA = engine.snapshotHash("A");
  const hashB = engine.snapshotHash("B");
  const hashC = engine.snapshotHash("C");

  console.log(`HASH(A)=${hashA}`);
  console.log(`HASH(B)=${hashB}`);
  console.log(`HASH(C)=${hashC}`);

  const converged = hashA === hashB && hashB === hashC;
  console.log(`\nCONVERGENCE SUCCEEDED: ${converged}`);
}

runDemo().catch(console.error);

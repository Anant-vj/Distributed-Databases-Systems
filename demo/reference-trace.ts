import { createEngine } from "../src/adapter.js";
import { referenceSchemaSql, rows } from "../src/tests/helpers.js";
import chalk from "chalk";

const engine = createEngine();

const wait = () => new Promise(resolve => setTimeout(resolve, 1000));

function dumpPeerState(peer: string) {
  const users = engine.execute(peer, "SELECT * FROM users");
  const orders = engine.execute(peer, "SELECT * FROM orders");

  const color =
    peer === "A"
      ? chalk.red
      : peer === "B"
      ? chalk.blue
      : chalk.green;

  console.log(color(`\n----- PEER ${peer} STATE -----`));

  console.log(color("USERS:"));
  console.log(JSON.stringify(rows(users), null, 2));

  console.log(color("ORDERS:"));
  console.log(JSON.stringify(rows(orders), null, 2));

  console.log(
    color(`HASH=${engine.snapshotHash(peer)}`)
  );
}

async function runDemo() {
  console.log(chalk.cyan.bold("\n=== ANVIL CRDT RELATIONAL ENGINE DEMO ==="));

  await wait();

  console.log(chalk.cyan("\n=== INITIALIZATION ==="));

  for (const peer of ["A", "B", "C"]) {
    engine.openPeer(peer);
    engine.applySchema(peer, referenceSchemaSql);

    const color =
      peer === "A"
        ? chalk.red
        : peer === "B"
        ? chalk.blue
        : chalk.green;

    console.log(color(`[${peer}] Peer initialized with reference schema`));
  }

  await wait();

  console.log(chalk.cyan("\n=== DISCONNECTED WRITES ==="));

  engine.execute("A", "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
    "u1",
    "ada@example.test",
    "Ada"
  ]);

  console.log(chalk.red("[A] Inserted user u1 (Ada)"));

  engine.sync("A", "B");
  engine.sync("A", "C");

  console.log(chalk.yellow("[SYNC] User u1 replicated to all peers"));

  await wait();

  console.log(chalk.cyan("\n=== CELL MERGE (CONCURRENT UPDATES) ==="));

  engine.execute(
    "A",
    "UPDATE users SET name = ? WHERE id = ?",
    ["Ada Lovelace", "u1"]
  );

  console.log(
    chalk.red("[A] Updated u1 name to 'Ada Lovelace'")
  );

  engine.execute(
    "B",
    "UPDATE users SET email = ? WHERE id = ?",
    ["ada.l@example.test", "u1"]
  );

  console.log(
    chalk.blue("[B] Updated u1 email to 'ada.l@example.test'")
  );

  console.log(
    chalk.yellow(
      "[INFO] A and B updated different columns while disconnected"
    )
  );

  await wait();

  console.log(chalk.cyan("\n=== UNIQUENESS CONFLICT ==="));

  engine.execute(
    "C",
    "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
    [
      "u2",
      "ada.l@example.test",
      "Imposter Ada"
    ]
  );

  console.log(
    chalk.green(
      "[C] Inserted user u2 with conflicting email"
    )
  );

  await wait();

  console.log(
    chalk.cyan("\n=== FK CONFLICT (DELETE VS CHILD INSERT) ===")
  );

  engine.execute(
    "A",
    "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
    [
      "u3",
      "bob@example.test",
      "Bob"
    ]
  );

  engine.sync("A", "B");

  console.log(
    chalk.yellow("[SYNC] A and B synchronized user u3")
  );

  engine.execute(
    "A",
    "DELETE FROM users WHERE id = ?",
    ["u3"]
  );

  console.log(
    chalk.red("[A] Deleted user u3 (Bob)")
  );

  engine.execute(
    "B",
    "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)",
    [
      "o1",
      "u3",
      "pending",
      5000
    ]
  );

  console.log(
    chalk.blue(
      "[B] Inserted order o1 referencing concurrently deleted user u3"
    )
  );

  await wait();

  console.log(chalk.cyan("\n=== BEFORE SYNC ==="));

  dumpPeerState("A");
  dumpPeerState("B");
  dumpPeerState("C");

  await wait();

  console.log(chalk.cyan("\n=== SYNC PHASE ==="));

  console.log(
    chalk.yellow("[SYNC] Synchronizing all peers to convergence...")
  );

  engine.sync("A", "B");
  console.log(chalk.yellow("[SYNC] A <-> B"));

  await wait();

  engine.sync("B", "C");
  console.log(chalk.yellow("[SYNC] B <-> C"));

  await wait();

  engine.sync("A", "C");
  console.log(chalk.yellow("[SYNC] A <-> C"));

  await wait();

  engine.sync("A", "B");
  console.log(chalk.yellow("[SYNC] Final propagation round"));

  await wait();

  console.log(chalk.cyan("\n=== AFTER SYNC ==="));

  dumpPeerState("A");
  dumpPeerState("B");
  dumpPeerState("C");

  await wait();

  console.log(chalk.cyan("\n=== FINAL STATE ==="));

  const users = engine.execute("A", "SELECT * FROM users");
  const orders = engine.execute("A", "SELECT * FROM orders");

  const conflicts =
    engine.snapshotState("A").unique.conflicts;

  console.log(chalk.red("Users:"));
  console.log(JSON.stringify(rows(users), null, 2));

  console.log(chalk.red("Orders:"));
  console.log(JSON.stringify(rows(orders), null, 2));

  console.log(chalk.red("Uniqueness Conflicts:"));
  console.log(JSON.stringify(conflicts, null, 2));

  await wait();

  console.log(chalk.cyan("\n=== HASH COMPARISON ==="));

  const hashA = engine.snapshotHash("A");
  const hashB = engine.snapshotHash("B");
  const hashC = engine.snapshotHash("C");

  console.log(chalk.magenta(`HASH(A)=${hashA}`));
  console.log(chalk.magenta(`HASH(B)=${hashB}`));
  console.log(chalk.magenta(`HASH(C)=${hashC}`));

  const converged =
    hashA === hashB &&
    hashB === hashC;

  console.log(
    converged
      ? chalk.green.bold(
          "\nCONVERGENCE SUCCEEDED"
        )
      : chalk.red.bold(
          "\nCONVERGENCE FAILED"
        )
  );
}

runDemo().catch(console.error);
import { createEngine } from "../src/adapter.js";
import { referenceSchemaSql } from "../src/tests/helpers.js";

const PEERS = ["P1", "P2", "P3", "P4", "P5"];
const OPS_COUNT = 200;
const SYNC_PROBABILITY = 0.15;

const engine = createEngine();

// Initialize peers
for (const p of PEERS) {
  engine.openPeer(p);
  engine.applySchema(p, referenceSchemaSql);
}

const userIds: string[] = [];
const orderIds: string[] = [];

function getRandomPeer() {
  return PEERS[Math.floor(Math.random() * PEERS.length)];
}

function getRandomId() {
  return Math.random().toString(36).substring(2, 7);
}

console.log(`Starting Chaos Test with ${PEERS.length} peers and ${OPS_COUNT} operations...`);

for (let i = 0; i < OPS_COUNT; i++) {
  const peer = getRandomPeer();
  const rand = Math.random();

  if (rand < 0.4) {
    // INSERT USER
    const id = `u-${getRandomId()}`;
    engine.execute(peer, "INSERT INTO users (id, email, name) VALUES (?, ?, ?)", [
      id,
      `${id}@example.test`,
      `User ${id}`
    ]);
    userIds.push(id);
  } else if (rand < 0.6 && userIds.length > 0) {
    // UPDATE USER
    const id = userIds[Math.floor(Math.random() * userIds.length)];
    engine.execute(peer, "UPDATE users SET name = ? WHERE id = ?", [
      `Updated ${getRandomId()}`,
      id
    ]);
  } else if (rand < 0.7 && userIds.length > 0) {
    // DELETE USER
    const id = userIds[Math.floor(Math.random() * userIds.length)];
    engine.execute(peer, "DELETE FROM users WHERE id = ?", [id]);
  } else if (rand < 0.9 && userIds.length > 0) {
    // INSERT ORDER
    const id = `o-${getRandomId()}`;
    const userId = userIds[Math.floor(Math.random() * userIds.length)];
    engine.execute(peer, "INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)", [
      id,
      userId,
      "pending",
      Math.floor(Math.random() * 10000)
    ]);
    orderIds.push(id);
  }

  // Periodic random sync
  if (Math.random() < SYNC_PROBABILITY) {
    const p1 = getRandomPeer();
    let p2 = getRandomPeer();
    while (p1 === p2) p2 = getRandomPeer();
    
    // Sometimes deliver syncs redundantly to test idempotence
    const isDuplicate = Math.random() < 0.2;
    engine.sync(p1, p2);
    if (isDuplicate) {
      engine.sync(p1, p2);
    }
  }
}

console.log("Random operations complete. Synchronizing all peers to convergence...");

// Final exhaustive synchronization
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < PEERS.length; i++) {
    for (let j = i + 1; j < PEERS.length; j++) {
      engine.sync(PEERS[i], PEERS[j]);
    }
  }
}

console.log("\n=== CONVERGENCE REPORT ===");
const hashes: Record<string, string> = {};
for (const p of PEERS) {
  hashes[p] = engine.snapshotHash(p);
  console.log(`${p}: ${hashes[p]}`);
}

const uniqueHashes = new Set(Object.values(hashes));
const success = uniqueHashes.size === 1;

console.log("\nCONVERGENCE SUCCEEDED:", success);

if (!success) {
  process.exit(1);
}

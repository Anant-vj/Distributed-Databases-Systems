import { createInterface } from "node:readline";
import { createEngine } from "../adapter.js";
import { DefaultForeignKeyPolicy, type ForeignKeyMode } from "../policies/foreignKeys.js";
import type { Scalar } from "../storage/types.js";

const fkPolicy = (process.env.FK_POLICY ?? "tombstone") as ForeignKeyMode;
const engine = createEngine({
  foreignKeyPolicy: new DefaultForeignKeyPolicy(fkPolicy)
});

interface BridgeRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface BridgeResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function respond(response: BridgeResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function handle(request: BridgeRequest): void {
  const params = request.params ?? {};
  try {
    switch (request.method) {
      case "open_peer":
        engine.openPeer(String(params.peer_id));
        respond({ id: request.id, ok: true, result: null });
        return;
      case "apply_schema": {
        const stmts = params.stmts as string[];
        engine.applySchema(String(params.peer_id), stmts);
        respond({ id: request.id, ok: true, result: null });
        return;
      }
      case "execute":
        engine.execute(
          String(params.peer_id),
          String(params.sql),
          (params.params as Scalar[]) ?? []
        );
        respond({ id: request.id, ok: true, result: null });
        return;
      case "sync":
        engine.sync(String(params.peer_a), String(params.peer_b));
        respond({ id: request.id, ok: true, result: null });
        return;
      case "snapshot_hash":
        respond({
          id: request.id,
          ok: true,
          result: engine.snapshotHash(String(params.peer_id))
        });
        return;
      case "snapshot_state":
        respond({
          id: request.id,
          ok: true,
          result: engine.snapshotTables(String(params.peer_id))
        });
        return;
      case "close":
        engine.close();
        respond({ id: request.id, ok: true, result: null });
        return;
      default:
        respond({ id: request.id, ok: false, error: `unknown method: ${request.method}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ id: request.id, ok: false, error: message });
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const request = JSON.parse(trimmed) as BridgeRequest;
  handle(request);
});

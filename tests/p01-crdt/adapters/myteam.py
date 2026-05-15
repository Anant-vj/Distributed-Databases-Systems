"""
Python adapter bridging the TypeScript CRDT engine for P-01 benchmarks.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from adapter import Adapter

VALID_FK_POLICIES = frozenset({"cascade", "tombstone", "orphan"})


def repo_root() -> Path:
    """Locate repository root (directory containing package.json)."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists():
            return parent
    raise RuntimeError("could not locate repository root from adapter path")


def fk_policy_from_argv(argv: list[str] | None = None) -> str:
    """Read --fk-policy from the benchmark CLI (harness does not pass it to Engine())."""
    args = argv if argv is not None else sys.argv
    for index, token in enumerate(args):
        if token == "--fk-policy" and index + 1 < len(args):
            policy = args[index + 1]
            if policy in VALID_FK_POLICIES:
                return policy
            raise ValueError(f"unsupported --fk-policy: {policy}")
    return "tombstone"


ROOT = repo_root()
TSX = ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
BRIDGE_SCRIPT = ROOT / "src" / "cli" / "bench-bridge.ts"


def bridge_cmd() -> list[str]:
    node = os.environ.get("NODE", "node")
    if TSX.exists():
        return [node, str(TSX), str(BRIDGE_SCRIPT)]
    return [node, "--import", "tsx", str(BRIDGE_SCRIPT)]


class Engine(Adapter):
    def __init__(self, fk_policy: str | None = None) -> None:
        self._fk_policy = fk_policy if fk_policy is not None else fk_policy_from_argv()
        self._proc: subprocess.Popen[str] | None = None
        self._next_id = 1

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._proc is None or self._proc.poll() is not None:
            env = os.environ.copy()
            env["FK_POLICY"] = self._fk_policy
            self._proc = subprocess.Popen(
                bridge_cmd(),
                cwd=ROOT,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
                env=env,
            )
        return self._proc

    def _call(self, method: str, **params: Any) -> Any:
        proc = self._ensure_process()
        request_id = self._next_id
        self._next_id += 1
        payload = {"id": request_id, "method": method, "params": params}
        assert proc.stdin is not None
        assert proc.stdout is not None
        proc.stdin.write(json.dumps(payload) + "\n")
        proc.stdin.flush()

        while True:
            line = proc.stdout.readline()
            if not line:
                stderr = proc.stderr.read() if proc.stderr else ""
                raise RuntimeError(f"bridge exited unexpectedly: {stderr}")
            response = json.loads(line)
            if response.get("id") != request_id:
                continue
            if not response.get("ok"):
                raise RuntimeError(response.get("error", "bridge error"))
            return response.get("result")

    def open_peer(self, peer_id: str) -> None:
        self._call("open_peer", peer_id=peer_id)

    def apply_schema(self, peer_id: str, stmts: list[str]) -> None:
        self._call("apply_schema", peer_id=peer_id, stmts=stmts)

    def execute(
        self,
        peer_id: str,
        sql: str,
        params: tuple[Any, ...] = (),
    ) -> None:
        self._call("execute", peer_id=peer_id, sql=sql, params=list(params))

    def sync(self, peer_a: str, peer_b: str) -> None:
        self._call("sync", peer_a=peer_a, peer_b=peer_b)

    def snapshot_hash(self, peer_id: str) -> str:
        return str(self._call("snapshot_hash", peer_id=peer_id))

    def snapshot_state(
        self,
        peer_id: str,
    ) -> dict[str, list[dict[str, Any]]]:
        return self._call("snapshot_state", peer_id=peer_id)

    def close(self) -> None:
        if self._proc is None:
            return
        try:
            self._call("close")
        finally:
            for stream in (self._proc.stdin, self._proc.stdout, self._proc.stderr):
                if stream:
                    stream.close()
            self._proc.terminate()
            self._proc.wait(timeout=5)
            self._proc = None

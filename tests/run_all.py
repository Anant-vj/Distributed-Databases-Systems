#!/usr/bin/env python3
"""
Run all project tests: TypeScript unit/property tests + P-01 harness + run.py + self_check.py.

Usage:
    python tests/run_all.py
    python tests/run_all.py --skip-ts
    python tests/run_all.py --quick
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = Path(__file__).resolve().parent


def run_typescript_tests() -> int:
    print("== TypeScript (vitest) ==")
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    return subprocess.run([npm, "test"], cwd=ROOT).returncode


def run_python_tests(quick: bool) -> int:
    print("== Python (unittest: scenarios, assertions, adapter, harness, CLIs) ==")
    argv = [
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        str(TESTS_DIR),
        "-p",
        "test_*.py",
        "-v",
    ]
    if quick:
        argv.extend(
            [
                "TestP01Harness.test_harness_all_axes_quick",
                "TestP01SelfCheck.test_self_check_quick_exit_zero",
            ]
        )
    return subprocess.run(argv, cwd=ROOT).returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run all Distributed-Databases-Systems tests")
    parser.add_argument("--skip-ts", action="store_true", help="Skip vitest unit tests")
    parser.add_argument("--skip-benchmark", action="store_true", help="Skip P-01 Python tests")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run quick harness check only (skip full run.py defaults)",
    )
    args = parser.parse_args(argv)

    failures: list[str] = []

    if not args.skip_ts and run_typescript_tests() != 0:
        failures.append("vitest")

    if not args.skip_benchmark:
        if args.quick:
            if run_python_tests(quick=True) != 0:
                failures.append("python-quick")
        else:
            if run_python_tests(quick=False) != 0:
                failures.append("python-unittest")

    if failures:
        print(f"\nFAILED: {', '.join(failures)}")
        return 1

    print("\nAll tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

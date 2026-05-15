# Tests

All automated tests for this project live under `tests/`.

## Layout

```
tests/
  run_all.py              # Run vitest + Python integration tests
  test_p01_assertions.py  # assertions.py unit + engine integration tests
  test_p01_adapter.py     # adapter.py interface + Engine compliance tests
  test_p01_dummy_adapter.py  # adapters/dummy.py harness validation tests
  test_p01_scenarios.py     # scenarios/reference, chaos, randomized tests
  test_p01_benchmark.py   # harness.py, run.py, self_check.py CLI tests
  p01-crdt/               # P-01 benchmark (vendored from Anvil-P-E)
    harness.py            # Scenario orchestration + scoring
    run.py                # Full benchmark CLI
    self_check.py         # Participant self-check matrix CLI
    assertions.py
    adapter.py
    scenarios/
    adapters/
      myteam.py           # Bridge to TypeScript engine
```

## Commands

From the repository root:

```bash
# Everything (TypeScript + P-01 harness + run.py + self_check.py)
python tests/run_all.py

# Quick iteration (vitest + harness quick seeds only)
python tests/run_all.py --quick

# TypeScript unit/property tests only
npm test

# Python integration tests only
python -m unittest discover -s tests -p "test_*.py" -v

# P-01 benchmark CLIs directly
cd tests/p01-crdt
python self_check.py --adapter adapters.myteam:Engine --fk-policy tombstone
python self_check.py --adapter adapters.myteam:Engine --fk-policy tombstone --quick
python run.py --adapter adapters.myteam:Engine --fk-policy tombstone --out report.json
```

## Adding future test cases

1. **P-01 variants** — extend `tests/p01-crdt/scenarios/` or add seeds; re-run `run.py`.
2. **New Python integration** — add `tests/test_<name>.py`; `unittest discover` picks it up automatically.
3. **Harness validation** — `adapters/dummy.py` is the reference weak adapter; `test_p01_dummy_adapter.py` asserts it runs but fails tombstone FK.
3. **TypeScript unit tests** — add files under `src/tests/*.test.ts`.

`tests/run_all.py` runs both stacks; no changes needed unless you add a third runner.

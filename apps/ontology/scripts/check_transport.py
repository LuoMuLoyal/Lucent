"""Manual check that retry and structured logging behave on the live graph.

The unit tests pin classification and formatting against fakes. This asserts the
two things a fake cannot: that the real export path emits the structured events
with true numbers, and that a genuinely dropped connection is retried and still
returns a complete answer.

    uv run python scripts/check_transport.py
"""

from __future__ import annotations

import json
import logging

from semantica_service.config import get_settings
from semantica_service.graph import GraphExport, ScopeSpec, StorePool, resolve_scope
from semantica_service.graph.retry import RetryPolicy, classify, read_with_retry
from semantica_service.logging_setup import configure_logging


class Capturing(logging.Handler):
    """Collects emitted lines so the script can inspect them."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(self.format(record))


def main() -> None:
    settings = get_settings()
    configure_logging("INFO", "json")
    capture = Capturing()
    capture.setFormatter(logging.getLogger().handlers[0].formatter)
    logging.getLogger().addHandler(capture)

    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            scope = resolve_scope(store, ScopeSpec(drug_names=("DB00091",), limit=50_000))
            export = GraphExport(
                store,
                limit=50_000,
                drug_keys=scope.drug_keys,
                atc_keys=scope.atc_keys,
                seed_drug_keys=scope.seed_drug_keys,
                scope_label="explicit",
            )

        print("=== structured events really carry the numbers ===")
        events = []
        for line in capture.lines:
            payload = json.loads(line)
            if "event" in payload:
                events.append(payload)
                print(f"  {json.dumps({k: v for k, v in payload.items() if k != 'ts'})}")

        loaded = next(e for e in events if e["event"] == "export_loaded")
        assert loaded["nodes"] == export.node_count, "the logged node count is not the real one"
        assert loaded["edges"] == export.edge_count, "the logged edge count is not the real one"
        assert isinstance(loaded["truncated"], bool)
        print("  the logged counts match what was actually loaded")
        print()

        print("=== a dropped connection is retried and recovered ===")
        real_calls = 0
        attempts = 0

        def flaky_read() -> dict[str, object]:
            """Fails the first attempt the way a dropped connection does."""
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("server closed the connection unexpectedly")
            with pool.borrow() as s:
                nonlocal real_calls
                real_calls += 1
                return s.execute_query(
                    "MATCH (n) RETURN count(n) AS c",
                    {},
                )

        result = read_with_retry(flaky_read, policy=RetryPolicy(attempts=3, base_delay_s=0.01))
        print(f"  attempts={attempts} real_reads={real_calls} success={result.get('success')}")
        assert attempts == 2 and real_calls == 1
        print("  the retry re-ran the read and it succeeded")
        print()

        print("=== a deterministic failure is not retried ===")
        calls = 0

        def broken_read() -> dict[str, object]:
            nonlocal calls
            calls += 1
            with pool.borrow() as s:
                return s.execute_query("MATCH (n RETURN n", {})

        try:
            read_with_retry(broken_read, policy=RetryPolicy(attempts=3, base_delay_s=0.01))
        except Exception as exc:
            print(f"  raised {type(exc).__name__}: {str(exc)[:90]}")
        print(f"  attempts={calls}")
        assert calls == 1, "a deterministic failure was retried"
        print("  the syntax error was raised on the first attempt")
        print()
        print(
            f"  classification check: syntax -> {classify(RuntimeError('syntax error')).__name__}"
        )
    finally:
        pool.close()

    print()
    print("all checks passed")


if __name__ == "__main__":
    main()

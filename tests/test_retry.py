"""Transport retry for graph reads.

The property that makes retrying safe is *idempotence*, not optimism: every
query the export issues is an ordered ``MATCH ... RETURN``, so re-running one
cannot change the graph or the answer. These tests pin both halves — that a
transient failure is retried, and that a deterministic one is not, because
retrying a syntax error spends the caller's budget to arrive at the same error
later while hiding it behind a longer wait.
"""

from __future__ import annotations

import pytest

from semantica_service.graph.retry import (
    PermanentReadError,
    RetryPolicy,
    TransientReadError,
    classify,
    read_with_retry,
)


class Recorder:
    """A sleep stand-in that records waits instead of performing them."""

    def __init__(self) -> None:
        self.waits: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


class Flaky:
    """Fails ``failures`` times, then succeeds."""

    def __init__(self, failures: int, error: BaseException) -> None:
        self.failures = failures
        self.error = error
        self.calls = 0

    def __call__(self) -> dict[str, object]:
        self.calls += 1
        if self.calls <= self.failures:
            raise self.error
        return {"success": True, "records": [], "attempt": self.calls}


CONNECTION_DROPPED = RuntimeError("server closed the connection unexpectedly")
SYNTAX_ERROR = RuntimeError("syntax error at or near MATCH")
TIMEOUT = RuntimeError("canceling statement due to statement timeout")


class TestClassification:
    def test_a_dropped_connection_is_transient(self) -> None:
        assert classify(CONNECTION_DROPPED) is TransientReadError

    def test_a_syntax_error_is_permanent(self) -> None:
        assert classify(SYNTAX_ERROR) is PermanentReadError

    def test_a_statement_timeout_is_permanent(self) -> None:
        """Retrying it would run the same expensive query into the same wall.

        A timeout is a statement about the query and the data, not about the
        transport, so another attempt cannot succeed and costs the caller the
        timeout again.
        """
        assert classify(TIMEOUT) is PermanentReadError

    def test_a_missing_graph_is_permanent(self) -> None:
        assert classify(RuntimeError('graph "lucent_graph" does not exist')) is PermanentReadError

    def test_permission_denied_is_permanent(self) -> None:
        assert (
            classify(RuntimeError("permission denied for table ag_catalog")) is PermanentReadError
        )

    def test_an_unknown_error_is_not_retried_forever(self) -> None:
        """Classification must terminate, not treat everything as retryable."""
        assert classify(ValueError("something new")) is PermanentReadError

    def test_a_permanent_marker_wins_over_a_transient_one(self) -> None:
        """A message naming both is a deterministic failure.

        A syntax error arriving on a connection that also reports itself closed
        is still a syntax error; preferring the transient reading would retry it
        three times.
        """
        both = RuntimeError("connection already closed; syntax error at or near X")

        assert classify(both) is PermanentReadError


class TestRetry:
    def test_a_transient_failure_is_retried_until_it_succeeds(self) -> None:
        sleep = Recorder()
        operation = Flaky(2, CONNECTION_DROPPED)
        policy = RetryPolicy(attempts=3, sleep=sleep)

        result = read_with_retry(operation, policy=policy)

        assert result["success"] is True
        assert operation.calls == 3
        assert len(sleep.waits) == 2

    def test_a_permanent_failure_is_raised_immediately(self) -> None:
        sleep = Recorder()
        operation = Flaky(5, SYNTAX_ERROR)
        policy = RetryPolicy(attempts=3, sleep=sleep)

        with pytest.raises(RuntimeError, match="syntax error"):
            read_with_retry(operation, policy=policy)

        assert operation.calls == 1, "a deterministic failure was retried"
        assert sleep.waits == []

    def test_the_original_error_survives_exhausted_retries(self) -> None:
        """The message has to reach the caller, not be replaced by "failed"."""
        operation = Flaky(9, CONNECTION_DROPPED)
        policy = RetryPolicy(attempts=2, sleep=Recorder())

        with pytest.raises(TransientReadError, match="server closed the connection"):
            read_with_retry(operation, policy=policy)

        assert operation.calls == 2

    def test_backoff_grows_and_is_capped(self) -> None:
        """A recovering server must not be stormed by synchronized retries."""
        policy = RetryPolicy(attempts=6, base_delay_s=0.05, max_delay_s=0.2)

        delays = [policy.delay_for(attempt) for attempt in range(5)]

        assert delays == sorted(delays)
        assert delays[0] == 0.05
        assert max(delays) <= 0.2

    def test_a_successful_read_does_not_sleep(self) -> None:
        sleep = Recorder()
        operation = Flaky(0, CONNECTION_DROPPED)

        read_with_retry(operation, policy=RetryPolicy(sleep=sleep))

        assert operation.calls == 1
        assert sleep.waits == []

    def test_retries_are_reported(self) -> None:
        """A run of retries is a signal about the dependency, not just noise."""
        seen: list[tuple[int, BaseException, float]] = []

        read_with_retry(
            Flaky(1, CONNECTION_DROPPED),
            policy=RetryPolicy(attempts=2, sleep=Recorder()),
            on_retry=lambda attempt, error, delay: seen.append((attempt, error, delay)),
        )

        assert len(seen) == 1
        assert seen[0][0] == 1

    def test_one_attempt_means_no_retry(self) -> None:
        operation = Flaky(1, CONNECTION_DROPPED)
        policy = RetryPolicy(attempts=1, sleep=Recorder())

        with pytest.raises(TransientReadError):
            read_with_retry(operation, policy=policy)

        assert operation.calls == 1

    def test_a_retry_re_runs_the_same_operation(self) -> None:
        """What is retried has to be the read itself, not a re-derived one.

        The closure the export builds binds the query text before the first
        attempt, so a retry cannot accidentally run a different query than the
        one that failed.
        """
        queries: list[str] = []

        def operation() -> dict[str, object]:
            queries.append("the query")
            if len(queries) < 2:
                raise CONNECTION_DROPPED
            return {"success": True}

        read_with_retry(operation, policy=RetryPolicy(attempts=2, sleep=Recorder()))

        assert queries == ["the query", "the query"]


class TestStoreResultsAreNotRetried:
    def test_a_failed_result_payload_is_returned_not_retried(self) -> None:
        """`success: False` is a query-level verdict, not a transport failure.

        The store reports deterministically; retrying it would repeat the same
        answer and hide the reason.
        """
        calls = 0

        def operation() -> dict[str, object]:
            nonlocal calls
            calls += 1
            return {"success": False, "error": "bad cypher"}

        result = read_with_retry(operation, policy=RetryPolicy(attempts=3, sleep=Recorder()))

        assert result["success"] is False
        assert calls == 1

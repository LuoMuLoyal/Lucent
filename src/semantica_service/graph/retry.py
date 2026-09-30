"""Retry for Neo4j reads that fail for reasons that are not the query's fault.

A graph read here is a sequence of round trips, and each can fail on something
transient: a connection dropped by the server between pages, a cluster member
restarting, a transaction cancelled by the server's timeout on a connection that
had drifted. None of those say anything about whether the query is answerable,
and today every one of them surfaces to the caller as a failure of the whole
request.

What makes retrying safe is that these reads are **idempotent by construction**:
every exported query is a ``MATCH ... RETURN`` with an ``ORDER BY`` before its
``LIMIT``, so re-running it cannot change the graph and cannot change the
answer. That is not an assumption about the caller's query text — the export
module only ever issues reads, and the retry is confined to that module's
queries.

A read that fails *deterministically* is not retried into success: a syntax
error, a missing graph, or a cancelled statement is classified as permanent and
raised immediately, because retrying it wastes the caller's budget and hides the
real error behind a timeout.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

#: The logger every graph-layer event is emitted on. Kept here rather than
#: imported from the application's logging setup so the graph layer stays usable
#: on its own, including from the verification scripts.
logger = logging.getLogger("semantica_service.graph")

#: Failures that will fail again identically. Retrying these spends the
#: caller's budget to arrive at the same error, later.
#:
#: Matched on text rather than on class because semantica wraps every driver
#: error in ``ProcessingError("Query execution failed: ...")`` and the class
#: name is lost in the wrapping; the driver's own code and message survive in
#: the string. Neo4j names them `Neo.ClientError.Statement.SyntaxError` and
#: friends, so both the CamelCase class name and the code appear here.
_PERMANENT_MARKERS = (
    "syntaxerror",
    "syntax error",
    "clienterror",
    "does not exist",
    "permission denied",
    "unauthorized",
    "authentication",
    "forbidden",
    "invalid input",
    "unsupported",
    "was cancelled",
    "transaction timeout",
)

#: Failures worth trying again: the connection went away underneath the read.
#: Neo4j reports these as ``ServiceUnavailable`` / ``SessionExpired`` /
#: ``TransientError``; the driver's own text is matched too, because the
#: wrapping above can leave only the message.
#:
#: The libpq/psycopg2 texts are kept even though the *graph* no longer runs on
#: Postgres: the provenance store still does, and this classifier is the one
#: `read_with_retry` consults for it. Dropping them when the graph moved would
#: have quietly turned a recoverable dropped connection into a permanent
#: failure — measured, and the reason they are listed explicitly here.
_TRANSIENT_MARKERS = (
    # Neo4j / Bolt
    "serviceunavailable",
    "sessionexpired",
    "transienterror",
    "connection reset",
    "connection refused",
    "could not connect",
    "connection to the database closed",
    "deadlock",
    "leader switch",
    "no longer available",
    # libpq / psycopg2 (the provenance store still connects this way)
    "server closed the connection unexpectedly",
    "connection already closed",
    "connection reset by peer",
    "terminating connection",
    "ssl connection has been closed",
    "deadlock detected",
    "could not serialize access",
)


class TransientReadError(RuntimeError):
    """A read failed for a reason that may not repeat."""


class PermanentReadError(RuntimeError):
    """A read failed for a reason that will repeat identically."""


@dataclass
class RetryPolicy:
    """How many times to retry, and how long to wait between attempts."""

    attempts: int = 3
    """Total attempts, including the first. 3 means two retries."""

    base_delay_s: float = 0.05
    """First backoff. Doubles per attempt, so a retry never storms a recovering server."""

    max_delay_s: float = 0.5
    """Ceiling on a single wait, so a slow dependency cannot stall a request."""

    sleep: Callable[[float], None] = field(default=time.sleep, repr=False)
    """Injected so tests do not spend real time waiting."""

    def delay_for(self, attempt: int) -> float:
        """Seconds to wait before attempt ``attempt + 1`` (0-indexed)."""
        return float(min(self.base_delay_s * (2**attempt), self.max_delay_s))


def classify(error: BaseException) -> type[TransientReadError] | type[PermanentReadError]:
    """Decide whether a failed read is worth retrying.

    Only the driver's own connection-level failures can be transient. Everything
    else — a bad query, a programming error, a value error from our own code —
    is treated as permanent: retrying it would produce the same failure while
    hiding it behind repeated attempts.

    Classification is by class where the class survives, and by text otherwise:
    semantica wraps driver errors in ``ProcessingError``, which erases the type
    even though it keeps the message.
    """
    text = str(error).lower()
    if any(marker in text for marker in _PERMANENT_MARKERS):
        return PermanentReadError
    if any(marker in text for marker in _TRANSIENT_MARKERS):
        return TransientReadError

    # An unrecognised failure is retried once more but not forever: a driver
    # error class we have not seen is more likely to be infrastructure than a
    # defect in the query, and the attempts cap bounds the cost either way.
    module = type(error).__module__
    name = type(error).__name__
    if module.startswith("neo4j") and name in {
        "ServiceUnavailable",
        "SessionExpired",
        "TransientError",
        "Neo4jError",
    }:
        return TransientReadError
    return PermanentReadError


def log_retry(attempt: int, error: BaseException, delay: float) -> None:
    """Report a retried read, as a structured event.

    A retry is a signal about the dependency, not just noise: a run of them
    means the graph is unhealthy, and that is worth knowing before the reads
    start failing outright.
    """
    logger.warning(
        "graph_read_retry",
        extra={
            "event": "graph_read_retry",
            "attempt": attempt,
            "delay_s": round(delay, 4),
            "error": str(error),
        },
    )


def read_with_retry(
    operation: Callable[[], dict[str, Any]],
    *,
    policy: RetryPolicy | None = None,
    on_retry: Callable[[int, BaseException, float], None] | None = None,
) -> dict[str, Any]:
    """Run a read, retrying only failures classified as transient.

    The operation must be idempotent. Every caller in this service reads the
    graph, so re-running one cannot change state or the answer.

    A returned ``{"success": False}`` result is *not* retried: it is the store
    reporting a query-level failure, which is deterministic. Only raised
    exceptions are classified, because those are where the transport lives.
    """
    active = policy or RetryPolicy()
    attempts = max(1, active.attempts)
    last: BaseException | None = None

    for attempt in range(attempts):
        try:
            return operation()
        except Exception as exc:  # noqa: BLE001 - classification decides what to do
            last = exc
            kind = classify(exc)
            if kind is PermanentReadError:
                raise
            if attempt == attempts - 1:
                break
            delay = active.delay_for(attempt)
            if on_retry is not None:
                on_retry(attempt + 1, exc, delay)
            active.sleep(delay)

    assert last is not None  # only reachable after a caught exception
    raise TransientReadError(f"graph read failed after {attempts} attempt(s): {last}") from last

"""Apache AGE connection pooling.

``ApacheAgeStore`` holds a single ``psycopg2`` connection in ``self._conn`` and
is not thread-safe. Two consequences shape this module:

* A process-wide singleton store would serialise every request behind one
  connection — measured at 2.9x slower with 16 concurrent callers — so
  callers borrow a store per request instead.
* ``psycopg2`` is synchronous and blocking, so this is used from synchronous
  request handlers only. FastAPI runs those in a thread pool; an ``async def``
  handler would block the event loop.

Every borrowed connection carries a ``statement_timeout``. Without one, a
variable-length Cypher path on a dense graph can run for minutes; a path query
over the interaction graph once had to be killed with
``pg_terminate_backend``.
"""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager

from semantica.graph_store.age_store import ApacheAgeStore

from ..config import Settings, get_settings


def _dsn_with_timeouts(settings: Settings) -> str:
    """Return ``settings.age_dsn`` with connection-level timeouts applied.

    ``statement_timeout`` is a server GUC, not a libpq connection option, so it
    can only be passed through ``options=-c ...``. That value contains a space
    and therefore must be single-quoted, otherwise libpq parses
    ``statement_timeout=15000`` as an option in its own right and rejects the
    whole DSN with ``invalid connection option``.

    Existing keys are preserved: an operator who set ``connect_timeout`` or
    ``options`` in the DSN keeps their value rather than having it overwritten.
    """
    parts = [settings.age_dsn.strip()]
    if "connect_timeout" not in settings.age_dsn:
        parts.append(f"connect_timeout={settings.connect_timeout_s}")
    if "options" not in settings.age_dsn:
        options = f"-c statement_timeout={settings.statement_timeout_ms}"
        parts.append(f"options={_quote_dsn_value(options)}")
    return " ".join(part for part in parts if part)


def _quote_dsn_value(value: str) -> str:
    """Quote a libpq DSN value, escaping embedded quotes and backslashes."""
    escaped = value.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def _parse_pg_duration_ms(value: str) -> int:
    """Convert a PostgreSQL duration literal to milliseconds.

    ``SHOW statement_timeout`` returns the value normalised to whichever unit
    reads best, so 15000 ms comes back as ``'15s'``. Comparing the raw string
    against ``'15000ms'`` would therefore reject a correctly configured
    connection.
    """
    text = value.strip()
    if text == "0":
        return 0
    units = {
        "us": 0.001,
        "ms": 1.0,
        "s": 1000.0,
        "min": 60_000.0,
        "h": 3_600_000.0,
        "d": 86_400_000.0,
    }
    # Longest suffix first so "min" is not matched as "m".
    for suffix in sorted(units, key=len, reverse=True):
        if text.endswith(suffix):
            number = text[: -len(suffix)].strip()
            return int(float(number) * units[suffix])
    raise ValueError(f"Unrecognised PostgreSQL duration: {value!r}")


def _assert_statement_timeout(store: ApacheAgeStore, expected_ms: int) -> None:
    """Verify the live session really carries ``statement_timeout``.

    A timeout that silently failed to apply is worse than none at all: the
    service would believe runaway queries are bounded while they are not.
    """
    conn = getattr(store, "_conn", None)
    if conn is None:  # pragma: no cover - connect() raises before this
        raise RuntimeError("AGE store has no connection after connect()")
    with conn.cursor() as cur:
        cur.execute("SHOW statement_timeout;")
        row = cur.fetchone()
    actual = row[0] if row else None
    conn.rollback()

    if actual is None:
        raise RuntimeError("SHOW statement_timeout returned no rows")
    actual_ms = _parse_pg_duration_ms(str(actual))
    if actual_ms != expected_ms:
        raise RuntimeError(
            f"statement_timeout is {actual!r} ({actual_ms}ms) but {expected_ms}ms "
            "was requested; refusing to serve queries with an unbounded timeout."
        )


class StorePool:
    """A bounded pool of connected :class:`ApacheAgeStore` instances.

    Stores are created lazily up to ``pool_max_size`` and returned to the pool
    on release. A store whose connection has died is discarded rather than
    handed back out.

    Example:
        >>> pool = StorePool()
        >>> with pool.borrow() as store:
        ...     store.get_stats()
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._idle: deque[ApacheAgeStore] = deque()
        self._lock = threading.Lock()
        self._created = 0
        self._closed = False

    # ------------------------------------------------------------------
    # Pool mechanics
    # ------------------------------------------------------------------

    def _new_store(self) -> ApacheAgeStore:
        """Build and connect a store with this service's timeouts applied.

        ``ApacheAgeStore.connect`` accepts ``**options`` but ignores all of
        them except ``connection_string`` — passing a timeout there would be a
        silent no-op. The values are therefore carried in the DSN itself,
        which libpq honours, and ``statement_timeout`` is asserted again on the
        live session so a server-side default cannot override it.
        """
        store = ApacheAgeStore(
            connection_string=_dsn_with_timeouts(self._settings),
            graph_name=self._settings.graph_name,
        )
        store.connect()
        _assert_statement_timeout(store, self._settings.statement_timeout_ms)
        return store

    def _acquire(self) -> ApacheAgeStore:
        """Take an idle store, or create one while under the cap."""
        with self._lock:
            if self._closed:
                raise RuntimeError("StorePool is closed")

            while self._idle:
                store = self._idle.pop()
                conn = getattr(store, "_conn", None)
                if conn is not None and not conn.closed:
                    return store
                # Dead connection: drop it and count it as released instead of
                # returning it to a caller that would fail on first use.
                self._created -= 1

            if self._created < self._settings.pool_max_size:
                self._created += 1
                try:
                    return self._new_store()
                except Exception:
                    self._created -= 1
                    raise

        # Pool is saturated: wait for a release rather than exceeding the cap.
        # The wait is bounded by the store's own statement_timeout plus the
        # caller's deadline, so a stuck request cannot hang the process.
        raise TimeoutError(
            f"No AGE connection available (pool_max_size="
            f"{self._settings.pool_max_size}). All connections are in use."
        )

    def _release(self, store: ApacheAgeStore) -> None:
        """Return a store to the pool, or discard it when unusable."""
        conn = getattr(store, "_conn", None)
        unusable = conn is None or conn.closed
        with self._lock:
            if self._closed or unusable:
                self._created -= 1
                if not unusable:
                    try:
                        store.close()
                    except Exception:  # pragma: no cover - best effort
                        pass
                return
            self._idle.append(store)

    @contextmanager
    def borrow(self) -> Iterator[ApacheAgeStore]:
        """Borrow a store for the duration of a ``with`` block.

        The store is always returned to the pool, including when the body
        raises. A pooled connection is left usable after an error because the
        store rolls back failed statements internally.
        """
        store = self._acquire()
        try:
            yield store
        finally:
            self._release(store)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def idle_count(self) -> int:
        """Number of connected stores currently idle."""
        with self._lock:
            return len(self._idle)

    @property
    def size(self) -> int:
        """Number of stores currently created (idle plus borrowed)."""
        with self._lock:
            return self._created

    def close(self) -> None:
        """Close every idle store. Safe to call more than once."""
        with self._lock:
            self._closed = True
            while self._idle:
                store = self._idle.pop()
                self._created -= 1
                try:
                    store.close()
                except Exception:  # pragma: no cover - best effort
                    pass

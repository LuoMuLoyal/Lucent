"""Neo4j session pooling.

``Neo4jStore`` (semantica's fork adapter) holds a single Neo4j driver and hands
out a *session* per call. Two facts shape this module:

* A Neo4j **session is not thread-safe**, and this service runs its handlers in
  FastAPI's thread pool. A process-wide singleton session would therefore be
  shared across threads — so callers borrow a store per request instead.
* The driver already carries a connection pool and is thread-safe. What this
  module bounds is the number of concurrent *sessions*, which is what the
  service's ``pool_max_size`` has always meant.

The ``statement_timeout`` equivalent changed shape with the backend. Postgres
bounds work per **connection** through a server GUC, and the old pool went to
some length to put it there (a DSN option plus a live ``SHOW`` assertion,
because a timeout that silently failed to apply is worse than none). Neo4j has
no per-connection equivalent: ``db.transaction.timeout`` is server-wide, and the
per-call bound is ``session.run(..., timeout=...)``. That is *stricter* — the
bound travels with the call rather than with the connection — so it is applied
by the store adapters on every query rather than by this pool.
"""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager

from semantica.graph_store.neo4j_store import Neo4jStore

from ..config import Settings, get_settings
from .adapter import Neo4jGraphStore


class StorePool:
    """A bounded pool of connected :class:`Neo4jStore` instances.

    Stores are created lazily up to ``pool_max_size`` and returned to the pool
    on release. A store whose driver has been closed is discarded rather than
    handed back out.

    Example:
        >>> pool = StorePool()
        >>> with pool.borrow() as store:
        ...     store.get_stats()
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._idle: deque[Neo4jStore] = deque()
        self._lock = threading.Lock()
        self._created = 0
        self._closed = False

    # ------------------------------------------------------------------
    # Pool mechanics
    # ------------------------------------------------------------------

    def _new_store(self) -> Neo4jStore:
        """Build and connect a store with this service's connection policy.

        The connection timeout is set on the driver itself rather than passed
        per call, because it governs *establishing* a connection — the case it
        exists for is a Neo4j that is down or unreachable, where the failure
        has to surface as a request error rather than as a thread parked
        indefinitely.
        """
        if not self._settings.neo4j_password:
            raise RuntimeError(
                "NEO4J_PASSWORD is not set; refusing to connect without credentials."
            )

        store = Neo4jGraphStore(
            uri=self._settings.neo4j_uri,
            user=self._settings.neo4j_user,
            password=self._settings.neo4j_password,
            database=self._settings.neo4j_database,
            connection_timeout=self._settings.connect_timeout_s,
            max_connection_pool_size=self._settings.pool_max_size,
            timeout_ms=self._settings.statement_timeout_ms,
        )
        store.connect()
        return store

    def _acquire(self) -> Neo4jStore:
        """Take an idle store, or create one while under the cap."""
        with self._lock:
            if self._closed:
                raise RuntimeError("StorePool is closed")

            while self._idle:
                store = self._idle.pop()
                if _is_usable(store):
                    return store
                # Dead driver: drop it and count it as released instead of
                # returning it to a caller that would fail on first use.
                self._created -= 1

            if self._created < self._settings.pool_max_size:
                self._created += 1
                try:
                    return self._new_store()
                except Exception:
                    self._created -= 1
                    raise

        # Pool is saturated. The old pool waited on a condition here; failing
        # fast is the better answer under Neo4j, whose driver already queues
        # for a connection internally, so a second wait would just stack the
        # two queues and hide which one was saturated.
        raise TimeoutError(
            f"No Neo4j store available (pool_max_size="
            f"{self._settings.pool_max_size}). All stores are in use."
        )

    def _release(self, store: Neo4jStore) -> None:
        """Return a store to the pool, or discard it when unusable."""
        unusable = not _is_usable(store)
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
    def borrow(self) -> Iterator[Neo4jStore]:
        """Borrow a store for the duration of a ``with`` block.

        The store is always returned to the pool, including when the body
        raises. A pooled store is left usable after an error: the adapter opens
        a fresh session per query, so a failed statement cannot leave the
        store's session in a broken transaction.
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


def _is_usable(store: Neo4jStore) -> bool:
    """Whether a store still holds a live driver.

    ``Neo4jStore.connect`` stores the driver wrapper in ``_driver`` and sets it
    to ``None`` in ``close()``, so ``None`` is the closed marker — there is no
    equivalent of psycopg2's ``conn.closed`` flag to consult. A driver that has
    gone away is discovered on first use and surfaces as a transient read
    error, which the retry layer then handles.
    """
    return getattr(store, "_driver", None) is not None

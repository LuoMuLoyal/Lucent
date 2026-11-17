"""The Neo4j store the service actually queries.

semantica's fork ships a working ``Neo4jStore`` (nodes, relationships, stats,
sessions, transactions), and the service's contract is only four methods of it,
so the adapter the plan expected to write is not needed. What *is* needed is two
corrections the fork's store does not make:

* **The timeout has to be enforced.** The previous backend bounded work with a
  server-side ``statement_timeout``, asserted on the live connection because a
  timeout that silently failed to apply is worse than none. Neo4j's per-call
  ``session.run(..., timeout=...)`` looks like the equivalent and **is not**:
  measured against Neo4j 5.26 it is accepted and ignored — a query asked to stop
  after 2s ran for 17.4s. The bound that *is* enforced is
  ``session.begin_transaction(timeout=...)``, which cancels server-side
  (``Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration``), so
  every query goes through a transaction carrying this service's timeout.
* **Reads must be read-only by the server, not by a scan.** The old backend
  decided read-onlyness with a keyword scan over the statement, because AGE's
  ``cypher()`` wrapper offered nothing better. Neo4j enforces it: a session
  opened in ``READ`` access mode rejects a write with
  ``Neo.ClientError.Statement.AccessMode``. That is a second, independent gate
  (the scan stays as the first), and unlike the scan it cannot be talked around
  by syntax the scan does not model.

The returned payload keeps the shape the rest of the service already consumes:
``{"success", "records", "keys", "metadata"}``.
"""

from __future__ import annotations

from typing import Any

from semantica.graph_store.neo4j_store import Neo4jStore as _ForkNeo4jStore

# semantica ships neither a py.typed marker nor stubs, so mypy sees this class
# as `Any`. Binding it to a name first keeps the subclass below checkable
# instead of turning every attribute access on it into an unchecked one.
Neo4jStore: Any = _ForkNeo4jStore


class Neo4jGraphStore(Neo4jStore):  # type: ignore[misc]
    """A ``Neo4jStore`` that bounds every query and never writes.

    Subclassing rather than wrapping keeps the four methods the service uses
    (``connect``, ``close``, ``get_stats``, ``execute_query``) inherited
    unchanged where they are already correct, while ``execute_query`` — the one
    on the request path — gets the timeout and the access mode.
    """

    def __init__(
        self,
        *,
        timeout_ms: int = 15_000,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._timeout_s = timeout_ms / 1000 if timeout_ms > 0 else None

    # ------------------------------------------------------------------
    # Query path
    # ------------------------------------------------------------------

    def execute_query(
        self,
        query: str,
        parameters: dict[str, Any] | None = None,
        **_options: Any,
    ) -> dict[str, Any]:
        """Run one read-only statement inside a bounded, read-only transaction.

        The statement is passed to the driver as a parameterised query: this is
        the whole point of the move off AGE, whose adapter had to escape
        literals into the query text because its ``cypher()`` wrapper would not
        accept ``$param``.
        """
        if not self._neo4j_available():
            from semantica.utils.exceptions import ProcessingError

            raise ProcessingError(
                "Neo4j is not available. Install it with: pip install neo4j"
            )

        with self._driver_session() as session:
            transaction = session.begin_transaction(timeout=self._timeout_s)
            try:
                result = transaction.run(query, parameters or {})
                keys = list(result.keys())
                records = [_as_row(record, keys) for record in result]
                transaction.commit()
            except Exception as exc:
                _safe_rollback(transaction)
                raise _as_processing_error(exc) from exc

        return {
            "success": True,
            "records": records,
            "keys": keys,
            "metadata": {"query": query},
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _neo4j_available() -> bool:
        from semantica.graph_store import neo4j_store

        return bool(neo4j_store.NEO4J_AVAILABLE)

    def _driver_session(self) -> Any:
        """Open a session that refuses writes.

        ``default_access_mode="READ"`` is a server-side check: a write under it
        fails with ``Neo.ClientError.Statement.AccessMode`` regardless of the
        statement's shape, which is what makes it a real second gate rather
        than another opinion about the text.
        """
        if self._driver is None:
            self.connect()
        assert self._driver is not None  # connect() raises otherwise
        return self._driver.driver.session(
            database=self.database,
            default_access_mode="READ",
        )


def _as_row(record: Any, keys: list[str]) -> dict[str, Any]:
    """Convert one Neo4j record to a JSON-shaped dict.

    Neo4j returns its own collection types (``Node``, ``Relationship``,
    ``Path``, ``List``) where AGE returned agtype parsed into dicts and lists.
    Values are converted to plain Python here so the response layer — which
    already walks dicts and lists — needs no knowledge of the driver.
    """
    row: dict[str, Any] = {}
    for key in keys:
        row[key] = _as_plain(record[key])
    return row


def _as_plain(value: Any) -> Any:
    """Recursively render a driver value as JSON-safe Python."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    # Driver types expose `items()` for their properties.
    if hasattr(value, "items") and not isinstance(value, (dict, list, tuple)):
        try:
            return {str(k): _as_plain(v) for k, v in value.items()}
        except Exception:  # noqa: BLE001 - fall through to stringification
            return str(value)
    if isinstance(value, dict):
        return {str(k): _as_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_as_plain(item) for item in value]
    if hasattr(value, "__iter__"):
        try:
            return [_as_plain(item) for item in value]
        except Exception:  # noqa: BLE001 - not iterable after all
            return str(value)
    return str(value)


def _safe_rollback(transaction: Any) -> None:
    """Roll back, ignoring a transaction the server already terminated.

    A timed-out transaction is closed server-side, so the rollback that follows
    raises "transaction has been terminated". That is the expected shape of a
    timeout, not a second error, and it must not replace the real one.
    """
    try:
        transaction.rollback()
    except Exception:  # noqa: BLE001 - the original error is the reportable one
        pass


def _as_processing_error(exc: BaseException) -> BaseException:
    """Wrap a driver error the way the rest of the service expects.

    semantica's ``ProcessingError`` is what the retry and classification layers
    already read (and what the old adapter raised), so a driver error is
    re-wrapped rather than allowed to escape as a raw neo4j exception. The
    driver's message — which carries the Neo4j code — is preserved verbatim,
    because ``classify_error`` matches on that text.
    """
    from semantica.utils.exceptions import ProcessingError

    error: BaseException = ProcessingError(f"Query execution failed: {exc}")
    return error

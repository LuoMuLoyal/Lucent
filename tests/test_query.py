"""POST /query — the read-only execution endpoint.

These run without a database: the AGE store is stubbed, so what is pinned here
is the HTTP contract (status codes, body shape, error kinds, row normalisation)
rather than AGE's own behaviour. Live-database behaviour is covered by the
scripts under ``scripts/`` (see ``docs/VERIFICATION.md``).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from conftest import TEST_API_TOKEN
from fastapi.testclient import TestClient
from semantica.utils.exceptions import ProcessingError

from semantica_service import main
from semantica_service.config import Settings

INTERACTION_QUERY = (
    "MATCH (d:Drug)-[r:INTERACTS_WITH]->(o:Drug) "
    "WHERE toLower(d.name) = $name "
    "RETURN o.name AS name, r.description AS description LIMIT 20"
)


class StubStore:
    """AGE store stand-in with a scripted result or failure."""

    def __init__(
        self,
        result: dict[str, Any] | None = None,
        error: Exception | None = None,
    ) -> None:
        self._result = (
            result if result is not None else {"success": True, "records": [], "keys": []}
        )
        self._error = error
        self.calls: list[tuple[str, Any]] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.calls.append((query, parameters))
        if self._error is not None:
            raise self._error
        return self._result

    def close(self) -> None:
        pass


class StubPool:
    def __init__(self, store: StubStore) -> None:
        self._store = store

    @contextmanager
    def borrow(self) -> Iterator[StubStore]:
        yield self._store

    @property
    def size(self) -> int:
        return 1

    @property
    def idle_count(self) -> int:
        return 0

    def close(self) -> None:
        pass


@pytest.fixture
def settings() -> Settings:
    return Settings(neo4j_database="neo4j", api_token=TEST_API_TOKEN)


def build_client(
    monkeypatch: pytest.MonkeyPatch, store: StubStore, settings: Settings
) -> TestClient:
    """An authenticated client; every route but /health requires the token."""
    monkeypatch.setattr(main, "StorePool", lambda _settings: StubPool(store))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return TestClient(main.create_app(), headers={"Authorization": f"Bearer {TEST_API_TOKEN}"})


def rows_store(records: list[dict[str, Any]], keys: list[str] | None = None) -> StubStore:
    """A store that answers with ``records`` and the columns AGE would report."""
    return StubStore(
        {
            "success": True,
            "keys": keys if keys is not None else list(records[0]) if records else [],
            "records": records,
        }
    )


# --- success ---------------------------------------------------------------


def test_query_returns_rows_and_columns(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store(
        [{"name": "Ibuprofen", "description": "bleeding risk"}],
        keys=["name", "description"],
    )
    with build_client(monkeypatch, store, settings) as client:
        response = client.post(
            "/query", json={"cypher": INTERACTION_QUERY, "params": {"name": "warfarin"}}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["columns"] == ["name", "description"]
    assert body["rows"] == [{"name": "Ibuprofen", "description": "bleeding risk"}]
    assert body["row_count"] == 1
    assert body["truncated"] is False
    assert isinstance(body["elapsed_ms"], int)
    assert body["elapsed_ms"] >= 0


def test_query_substitutes_params_through_the_store(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Parameters go to the store as values — they are never spliced into the
    statement by this service."""
    store = rows_store([])
    params = {"name": "warfarin", "max": 3, "flag": True}
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": INTERACTION_QUERY, "params": params})

    assert response.status_code == 200
    assert store.calls == [(INTERACTION_QUERY, params)]


def test_query_defaults_params_to_an_empty_mapping(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([])
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    assert response.status_code == 200
    assert store.calls == [("MATCH (n) RETURN n", {})]


def test_query_strips_a_trailing_terminator_before_executing(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """AGE's ``cypher()`` takes one statement; the separator is not part of it."""
    store = rows_store([])
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n;  "})

    assert response.status_code == 200
    assert store.calls[0][0] == "MATCH (n) RETURN n"


def test_query_returns_an_empty_result_without_error(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([], keys=["name"])
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n:Drug) RETURN n.name AS name"})

    body = response.json()
    assert response.status_code == 200
    assert body["columns"] == ["name"]
    assert body["rows"] == []
    assert body["row_count"] == 0
    assert body["truncated"] is False


# --- the response limit ----------------------------------------------------


def test_query_truncates_to_the_limit_and_flags_it(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The statement is never rewritten, so the database may produce more rows
    than the caller asked for; the response carries only the first `limit`."""
    records = [{"name": name} for name in ("A", "B", "C")]
    with build_client(monkeypatch, rows_store(records), settings) as client:
        response = client.post(
            "/query", json={"cypher": "MATCH (n:Drug) RETURN n.name AS name", "limit": 2}
        )

    body = response.json()
    assert response.status_code == 200
    assert body["row_count"] == 2
    assert [row["name"] for row in body["rows"]] == ["A", "B"]
    assert body["truncated"] is True


def test_query_does_not_flag_truncation_at_exactly_the_limit(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    records = [{"name": name} for name in ("A", "B")]
    with build_client(monkeypatch, rows_store(records), settings) as client:
        response = client.post(
            "/query", json={"cypher": "MATCH (n:Drug) RETURN n.name AS name", "limit": 2}
        )

    assert response.json()["truncated"] is False


@pytest.mark.parametrize("limit", [1, 100, 500])
def test_query_accepts_limits_inside_the_range(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, limit: int
) -> None:
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n", "limit": limit})

    assert response.status_code == 200


@pytest.mark.parametrize("limit", [0, -1, 501, 10_000])
def test_query_rejects_limits_outside_the_range(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, limit: int
) -> None:
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n", "limit": limit})

    assert response.status_code == 422


# --- JSON normalisation ----------------------------------------------------


class Exotic:
    """Stands in for an AGE value the JSON encoder has never seen."""

    def __str__(self) -> str:
        return "exotic-value"


def test_query_normalises_exotic_values(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """AGE hands back agtype objects a JSON encoder refuses; they are stringified
    rather than dropped, so a caller still sees that a value existed."""
    records = [
        {
            "props": {"tags": ("a", "b"), "rank": float("nan"), "obj": Exotic()},
            "list": [1, {"nested": {2}}],
            "none": None,
            "count": 3,
            "active": True,
        }
    ]
    with build_client(monkeypatch, rows_store(records), settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    # A 200 is the assertion that matters: had anything survived unnormalised,
    # Starlette's encoder would have refused the payload.
    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["props"]["tags"] == ["a", "b"]
    assert row["props"]["rank"] == "nan"
    assert row["props"]["obj"] == "exotic-value"
    assert row["list"] == [1, {"nested": [2]}]
    assert row["none"] is None
    assert row["count"] == 3
    assert row["active"] is True


def test_query_falls_back_to_row_keys_when_age_reports_no_columns(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = StubStore({"success": True, "records": [{"name": "Aspirin", "id": "DB00945"}]})
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    assert response.json()["columns"] == ["name", "id"]


# --- the read-only guard over HTTP ----------------------------------------


def test_query_refuses_a_write_clause(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    store = rows_store([])
    cypher = "MATCH (n:Drug) SET n.approved = true RETURN n.name AS name"
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["kind"] == "not_read_only"
    assert "SET" in detail["message"]
    # The caller's retry loop needs the statement it sent, not a paraphrase.
    assert detail["cypher"] == cypher
    assert store.calls == []


def test_query_refuses_a_statement_that_does_not_start_with_a_read_only_clause(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": "EXPLAIN MATCH (n) RETURN n"})

    detail = response.json()["detail"]
    assert response.status_code == 422
    assert detail["kind"] == "not_read_only"
    assert "must begin with" in detail["message"]


def test_query_does_not_trip_on_a_write_keyword_inside_a_literal(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """`RETURN 'delete this' AS note` is a projection, not a DELETE."""
    store = rows_store([{"note": "delete this"}], keys=["note"])
    cypher = "MATCH (n:Drug) RETURN 'delete this' AS note"
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    assert response.status_code == 200
    assert response.json()["rows"] == [{"note": "delete this"}]
    assert store.calls[0][0] == cypher


def test_query_does_not_trip_on_a_write_keyword_inside_a_comment(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([{"name": "Aspirin"}], keys=["name"])
    cypher = "// DELETE the stale rows\nMATCH (n:Drug) RETURN n.name AS name"
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    assert response.status_code == 200


def test_query_refuses_two_statements(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    cypher = "MATCH (n) RETURN n; MATCH (m) DELETE m"
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    detail = response.json()["detail"]
    assert response.status_code == 422
    assert detail["kind"] == "multiple_statements"
    assert detail["cypher"] == cypher


@pytest.mark.parametrize(
    "cypher",
    [
        "MATCH (a), (b) RETURN shortestPath((a)-[*]->(b)) AS p",
        "MATCH (a)-[r:TARGETS|BINDS]->(b) RETURN r",
        "MATCH (n) WHERE n.at = datetime() RETURN n",
    ],
)
def test_query_accepts_constructs_age_could_not_run(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, cypher: str
) -> None:
    """These were refused because AGE could not parse them. Neo4j can, so the
    endpoint must execute them rather than preserve the old limitation."""
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    assert response.status_code == 200


# --- failure classification over HTTP -------------------------------------


def test_query_reports_a_syntax_error(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    cypher = "MATCH (n) RETURN n..name"
    store = StubStore(error=ProcessingError('Query execution failed: syntax error at or near ".."'))
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    detail = response.json()["detail"]
    assert response.status_code == 422
    assert detail["kind"] == "syntax_error"
    assert "syntax error" in detail["message"]
    assert detail["cypher"] == cypher


def test_query_reports_a_timeout(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    store = StubStore(
        error=ProcessingError(
            "Query execution failed: {neo4j_code: "
            "Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration} "
            "{message: The transaction has been terminated.}"
        )
    )
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    detail = response.json()["detail"]
    assert response.status_code == 422
    assert detail["kind"] == "timeout"
    assert "timeout" in detail["message"]


def test_query_reports_an_unexpected_failure_as_internal(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = StubStore(error=RuntimeError("the connection died mid-query"))
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    detail = response.json()["detail"]
    assert response.status_code == 422
    assert detail["kind"] == "internal"
    assert "the connection died mid-query" in detail["message"]
    assert "Traceback" not in detail["message"]


def test_query_reports_a_failed_payload_as_an_error(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A store that reports failure in its result must not be answered with rows."""
    store = StubStore({"success": False, "error": 'syntax error at or near "FOO"'})
    with build_client(monkeypatch, store, settings) as client:
        response = client.post("/query", json={"cypher": "MATCH (n) RETURN n"})

    assert response.status_code == 422
    assert response.json()["detail"]["kind"] == "syntax_error"


# --- request validation ----------------------------------------------------


def test_query_rejects_a_missing_or_blank_statement(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, rows_store([]), settings) as client:
        missing = client.post("/query", json={})
        blank = client.post("/query", json={"cypher": "   \n"})

    assert missing.status_code == 422
    assert blank.status_code == 422


def test_query_rejects_an_oversized_statement(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """8 KB is the ceiling; a generated statement that long is a runaway."""
    cypher = "MATCH (n) RETURN n" + " " * 8192
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post("/query", json={"cypher": cypher})

    assert response.status_code == 422


def test_query_rejects_non_scalar_params(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, rows_store([]), settings) as client:
        response = client.post(
            "/query",
            json={"cypher": "MATCH (n) RETURN n", "params": {"nested": {"a": 1}}},
        )

    assert response.status_code == 422


# --- schema surface --------------------------------------------------------


def test_query_appears_in_openapi(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """The Lucent client is generated from this document."""
    with build_client(monkeypatch, rows_store([]), settings) as client:
        paths = client.get("/openapi.json").json()["paths"]

    assert "/query" in paths

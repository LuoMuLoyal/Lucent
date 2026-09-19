"""The reasoning endpoints: /schema, /validate, /reason.

These run without a database. The AGE store is stubbed so the suite stays
runnable anywhere; the tests assert the HTTP contract (status codes, response
shape, error reporting) rather than semantica's internals, which the fork's own
suite covers.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from semantica_service import main
from semantica_service.config import Settings


class StubStore:
    """AGE store stand-in driven by canned stats and query results."""

    def __init__(self, stats: dict[str, Any] | None = None) -> None:
        self._stats = (
            stats
            if stats is not None
            else {
                "node_count": 3,
                "relationship_count": 2,
                "label_counts": {"Drug": 2, "Protein": 1},
                "relationship_type_counts": {"TARGETS": 2},
            }
        )

    def get_stats(self) -> dict[str, Any]:
        return self._stats

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        if "MATCH (n)" in query:
            return {
                "success": True,
                "records": [
                    {"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}},
                    {"id": 2, "labels": ["Drug"], "props": {"name": "Warfarin"}},
                    {"id": 3, "labels": ["Protein"], "props": {"name": "COX1"}},
                ],
            }
        return {
            "success": True,
            "records": [
                {
                    "source": 1,
                    "target": 3,
                    "rel_type": "TARGETS",
                    "props": {},
                    "source_labels": ["Drug"],
                }
            ],
        }

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
    return Settings(graph_name="lucent_graph")


def build_client(
    monkeypatch: pytest.MonkeyPatch, store: StubStore, settings: Settings
) -> TestClient:
    monkeypatch.setattr(main, "StorePool", lambda _settings: StubPool(store))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return TestClient(main.create_app())


# --- /schema ---------------------------------------------------------------


def test_schema_lists_labels_and_types(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.get("/schema")

    assert response.status_code == 200
    body = response.json()
    assert body["graph"] == "lucent_graph"
    assert body["node_count"] == 3
    assert {item["label"] for item in body["labels"]} == {"Drug", "Protein"}
    assert body["relationship_types"] == [{"label": "TARGETS", "count": 2}]


def test_schema_orders_by_count_then_name(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A response that reshuffles between calls is needlessly hard to diff."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        first = client.get("/schema").json()
        second = client.get("/schema").json()

    assert first == second
    assert [item["label"] for item in first["labels"]] == ["Drug", "Protein"]


def test_schema_on_an_empty_graph_is_not_an_error(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """An empty graph is a legitimate state to report."""
    empty = StubStore(
        {
            "node_count": 0,
            "relationship_count": 0,
            "label_counts": {},
            "relationship_type_counts": {},
        }
    )
    with build_client(monkeypatch, empty, settings) as client:
        response = client.get("/schema")

    assert response.status_code == 200
    assert response.json()["labels"] == []


# --- /reason ---------------------------------------------------------------


def test_reason_derives_transitive_closure(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The classic Datalog case, over request-supplied facts."""
    payload = {
        "facts": [
            {"fact": "parent(tom, bob)"},
            {"fact": "parent(bob, ann)"},
        ],
        "rules": [
            {"rule": "ancestor(X, Y) :- parent(X, Y)."},
            {"rule": "ancestor(X, Z) :- parent(X, Y), ancestor(Y, Z)."},
        ],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 200
    derived = set(response.json()["derived"])
    assert "ancestor(tom, ann)" in derived
    assert "ancestor(tom, bob)" in derived


def test_reason_honours_inequality_constraints(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Inequalities were the subject of a fork fix; they must not be ignored."""
    payload = {
        "facts": [
            {"fact": "takes(alice, aspirin)"},
            {"fact": "takes(bob, aspirin)"},
        ],
        "rules": [{"rule": "conflict(X, Y) :- takes(X, D), takes(Y, D), X != Y."}],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 200
    derived = set(response.json()["derived"])
    # alice and bob share a drug, so a conflict is derived...
    assert any("conflict" in fact and "alice" in fact and "bob" in fact for fact in derived)
    # ...but nothing is in conflict with itself.
    assert not any(fact.startswith("conflict(alice, alice") for fact in derived)


def test_reason_query_returns_bindings(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    payload = {
        "facts": [{"fact": "parent(tom, bob)"}],
        "rules": [{"rule": "ancestor(X, Y) :- parent(X, Y)."}],
        "query": "ancestor(tom, ?Y)",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 200
    assert response.json()["bindings"] == [{"Y": "bob"}]


def test_reason_with_no_facts_is_rejected(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Reporting "derived nothing" would hide the caller's wiring mistake."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json={"rules": [{"rule": "a(X) :- b(X)."}]})

    assert response.status_code == 422
    assert "No facts" in response.json()["detail"]


def test_reason_rejects_a_malformed_rule(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    payload = {"facts": [{"fact": "parent(tom, bob)"}], "rules": [{"rule": "this is not a rule"}]}
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    assert "Invalid rule" in response.json()["detail"]


def test_reason_rejects_a_malformed_fact(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json={"facts": [{"fact": "((("}]})

    assert response.status_code == 422
    assert "Invalid fact" in response.json()["detail"]


def test_reason_loads_facts_from_the_graph(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """load_from_graph goes through the export bridge, not the raw store."""
    payload = {
        "load_from_graph": True,
        "rules": [{"rule": "targets(X, Y) :- targets(X, Y)."}],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 200
    body = response.json()
    # Three nodes plus one edge were exported and became facts.
    assert body["fact_count"] >= 4
    assert any("targets" in fact for fact in body["derived"])


def test_reason_rejects_an_invalid_query(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    payload = {
        "facts": [{"fact": "parent(tom, bob)"}],
        "query": "not a valid pattern",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    assert "Invalid query" in response.json()["detail"]


# --- /validate -------------------------------------------------------------


SHACL_SHAPES = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix lucent: <http://lucent.local/graph#> .

lucent:DrugShape a sh:NodeShape ;
    sh:targetClass lucent:Drug ;
    sh:property [
        sh:path lucent:name ;
        sh:minCount 1 ;
        sh:message "A Drug must have a name." ;
    ] .
"""


def test_validate_requires_exactly_one_shape_source(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """semantica rejects both-or-neither; the endpoint surfaces it as 422."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        neither = client.post("/validate", json={})
        both = client.post("/validate", json={"shacl": SHACL_SHAPES, "ontology": {"concepts": []}})

    assert neither.status_code == 422
    assert both.status_code == 422
    assert "exactly one" in neither.json()["detail"].lower()


def test_validate_conforming_graph(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/validate", json={"shacl": SHACL_SHAPES})

    assert response.status_code == 200
    body = response.json()
    assert body["shacl_source"] == "inline"
    assert body["summary"]


def test_validate_reports_violations(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """A shape requiring a property the graph lacks must produce violations."""
    strict = """
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix lucent: <http://lucent.local/graph#> .

    lucent:DrugShape a sh:NodeShape ;
        sh:targetClass lucent:Drug ;
        sh:property [
            sh:path lucent:approval_status ;
            sh:minCount 1 ;
            sh:message "A Drug must have an approval_status." ;
        ] .
    """
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/validate", json={"shacl": strict})

    assert response.status_code == 200
    body = response.json()
    assert body["conforms"] is False
    assert body["violation_count"] > 0
    assert body["violations"][0]["component"] or body["violations"][0]["message"]


def test_validate_rejects_an_empty_graph(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """An empty graph conforms vacuously, which would be misleading."""

    class EmptyStore(StubStore):
        def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
            return {"success": True, "records": []}

    with build_client(monkeypatch, EmptyStore(), settings) as client:
        response = client.post("/validate", json={"shacl": SHACL_SHAPES})

    assert response.status_code == 422
    assert "no nodes" in response.json()["detail"].lower()


# --- schema surface --------------------------------------------------------


def test_all_endpoints_appear_in_openapi(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The Lucent client is generated from this document."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        paths = client.get("/openapi.json").json()["paths"]

    assert set(paths) >= {"/health", "/schema", "/validate", "/reason"}

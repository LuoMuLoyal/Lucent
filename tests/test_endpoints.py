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
    """AGE store stand-in driven by canned stats and query results.

    The default stats carry every relationship type the shipped rule library
    consumes, because startup verifies the library against this vocabulary: a
    stub reporting a narrower graph would (correctly) stop the app from booting,
    which is a property of the rules rather than of whatever a test is checking.
    """

    def __init__(self, stats: dict[str, Any] | None = None) -> None:
        self._stats = (
            stats
            if stats is not None
            else {
                "node_count": 3,
                "relationship_count": 2,
                "label_counts": {"Drug": 2, "Protein": 1},
                "relationship_type_counts": {
                    # Exactly the types the shipped rule library consumes, so
                    # startup verification passes. A stub reporting a narrower
                    # graph would correctly refuse to boot.
                    "TARGETS": 2,
                    "INHIBITS": 2,
                    "SUBSTRATE_OF": 1,
                    "ACTS_ON": 1,
                    "IN_ATC_CLASS": 1,
                },
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


class ScopedStore(StubStore):
    """A store that mimics the scoped export, including its resolution queries.

    Scope resolution reads Drug / ATCClass nodes by name or code before the
    export itself runs, so a stub that only knows the export queries would make
    every scope look empty.
    """

    def __init__(self, *, matching: bool) -> None:
        super().__init__()
        self._matching = matching
        self.parameters: list[Any] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.parameters.append(parameters)
        if "toLower(d.name) IN $names" in query:
            if not self._matching:
                return {"success": True, "records": []}
            return {"success": True, "records": [{"key": "DB00945", "name": "Aspirin"}]}
        if "c.code STARTS WITH $prefix" in query:
            return {"success": True, "records": [{"key": "L01XX29", "name": "L01XX29"}]}
        if "UNWIND $codes" in query:
            return {"success": True, "records": [{"key": "DB00945", "name": "Aspirin"}]}
        return super().execute_query(query, parameters)


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
    assert {item["label"] for item in body["relationship_types"]} == {
        "TARGETS",
        "INHIBITS",
        "SUBSTRATE_OF",
        "ACTS_ON",
        "IN_ATC_CLASS",
    }
    # Ordered by count then name, so the response is diffable between calls.
    # INHIBITS and TARGETS both have 2, and the tie breaks on the name.
    assert body["relationship_types"][0] == {"label": "INHIBITS", "count": 2}


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
        "scope_all": True,
        "rules": [{"rule": "targets(X, Y) :- targets(X, Y)."}],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 200
    body = response.json()
    # Three nodes plus one edge were exported and became facts.
    assert body["fact_count"] >= 4
    assert any("targets" in fact for fact in body["derived"])


def test_graph_backed_reason_requires_a_scope(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Reasoning over an unstated slice cannot distinguish absent from false.

    Datalog has no negation, so "not derived" is its only answer for "not
    present". That answer carries information only if the caller knows what was
    loaded, so the extent must be stated rather than defaulted.
    """
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json={"load_from_graph": True})

    assert response.status_code == 422
    assert "scope" in response.json()["detail"]


def test_graph_backed_reason_echoes_the_range_it_loaded(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The response states the extent, which is what makes an empty result readable."""
    payload = {"load_from_graph": True, "scope_all": True}
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    reason_range = body["range"]
    assert reason_range["scope"] == "all"
    assert reason_range["node_count"] == 3
    assert reason_range["edge_count"] == 1
    assert reason_range["truncated"] is False


def test_a_scope_that_matches_nothing_is_refused_not_answered(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """ "No derivations" for an empty scope is a statement about nobody.

    Returning an empty result would let a typo'd drug name read as a clean
    negative finding.
    """
    payload = {
        "load_from_graph": True,
        "scope": {"drug_names": ["NotADrug"]},
    }
    with build_client(monkeypatch, ScopedStore(matching=False), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    assert "matched nothing" in response.json()["detail"]


def test_a_scope_resolves_to_drug_keys(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """A scope named in drug names is resolved into the keys facts are built from."""
    payload = {
        "load_from_graph": True,
        "scope": {"drug_names": ["Aspirin"]},
        "facts": [{"fact": "placeholder(1)"}],
    }
    store = ScopedStore(matching=True)
    with build_client(monkeypatch, store, settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["range"]["drug_keys"] == ["DB00945"]
    assert any(p and p.get("drug_keys") == ["DB00945"] for p in store.parameters if p)


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


# --- /rules ----------------------------------------------------------------


def test_rules_lists_the_library(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """A caller has to discover which intents exist before it can name one."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.get("/rules")

    assert response.status_code == 200
    rules = response.json()["rules"]
    assert rules
    by_intent = {rule["intent"]: rule for rule in rules}
    assert "interaction" in by_intent
    assert by_intent["interaction"]["id"]
    assert by_intent["interaction"]["derives"]
    assert by_intent["interaction"]["consumes"]


# --- /reason with a library rule -------------------------------------------


def test_reason_names_the_rule_it_applied(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A conclusion has to say which rule produced it, or it is just a fact."""
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "intent": "interaction",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["rule"]["id"] == "potential_ddi_inhibitor_substrate"
    assert body["rule"]["intent"] == "interaction"


def test_a_conclusion_is_marked_derived_not_asserted(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The plan's hard constraint: inference must not wear assertion's clothes."""
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "intent": "interaction",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    conclusions = body["conclusions"]
    assert conclusions
    for conclusion in conclusions:
        assert conclusion["verifiability"] == "derived"
        assert conclusion["rule_id"] == "potential_ddi_inhibitor_substrate"


def test_a_conclusion_carries_its_premises(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Without premises a conclusion cannot be checked by whoever reads it."""
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "intent": "interaction",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    conclusion = next(c for c in body["conclusions"] if c["object"] == "db2")
    assert conclusion["subject"] == "db1"
    assert conclusion["predicate"] == "potential_ddi"


def test_only_the_rules_own_head_becomes_a_conclusion(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Reporting every derived fact would present the premises as findings."""
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "intent": "interaction",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["conclusions"]
    assert {c["predicate"] for c in body["conclusions"]} == {"potential_ddi"}


def test_reason_refuses_an_unknown_intent(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """An unrecognised intent must not quietly run nothing and report success."""
    payload = {"facts": [{"fact": "inhibits(db1, e1)"}], "intent": "no_such_intent"}
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "no_such_intent" in detail
    # The list is included so the caller can correct the request without a
    # second round trip to /rules.
    assert "interaction" in detail


def test_reason_refuses_both_intent_and_rule_id(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    payload = {
        "facts": [{"fact": "inhibits(db1, e1)"}],
        "intent": "interaction",
        "rule_id": "potential_ddi_inhibitor_substrate",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    assert "at most one" in response.json()["detail"]


def test_reason_accepts_a_rule_by_id(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "rule_id": "potential_ddi_inhibitor_substrate",
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["rule"]["id"] == "potential_ddi_inhibitor_substrate"
    assert body["conclusions"]


def test_request_supplied_rules_produce_no_attributed_conclusions(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Only reviewed rules are citable, so an inline rule cannot claim a rule_id."""
    payload = {
        "facts": [
            {"fact": "inhibits(db1, e1)"},
            {"fact": "substrate_of(db2, e1)"},
        ],
        "rules": [{"rule": "potential_ddi(A, B) :- inhibits(A, E), substrate_of(B, E), A != B."}],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    # The facts were still derived...
    assert any("potential_ddi" in fact for fact in body["derived"])
    # ...but nothing claims them as a library rule's output.
    assert body["rule"] is None
    assert body["conclusions"] == []
    assert body["conclusions_complete"] is True


def test_reason_without_a_rule_still_reasons(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Naming a rule is optional; the endpoint's original contract still holds."""
    payload = {
        "facts": [{"fact": "inhibits(db1, e1)"}],
        "rules": [{"rule": "inhibited(A) :- inhibits(A, E)."}],
    }
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["fact_count"] >= 1
    assert body["rule"] is None


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

    assert set(paths) >= {"/health", "/schema", "/validate", "/reason", "/resolve"}


# --- /reason: the label table ----------------------------------------------


class KeyedStore(StubStore):
    """A store whose nodes carry business identifiers and names."""

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        if "MATCH (n)" in query:
            return {
                "success": True,
                "records": [
                    {
                        "id": 1,
                        "labels": ["Drug"],
                        "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                    },
                    {
                        "id": 2,
                        "labels": ["Drug"],
                        "props": {"drugbank_id": "DB01050", "name": "Ibuprofen"},
                    },
                    {
                        "id": 3,
                        "labels": ["Protein"],
                        "props": {"uniprot_id": "P23219", "name": "COX-1"},
                    },
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
                    "source_props": {"drugbank_id": "DB00945"},
                    "target_props": {"uniprot_id": "P23219"},
                },
                {
                    "source": 2,
                    "target": 3,
                    "rel_type": "TARGETS",
                    "props": {},
                    "source_props": {"drugbank_id": "DB01050"},
                    "target_props": {"uniprot_id": "P23219"},
                },
            ],
        }


def test_reason_returns_a_label_table_alongside_facts(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A caller needs names to show a derived fact to a user or an assistant.

    The facts themselves stay keyed by identifier, because that is what keeps
    Datalog constants unique and stable.
    """
    body = {
        "load_from_graph": True,
        "scope_all": True,
        "rules": [{"rule": "shares_target(A, B) :- targets(A, T), targets(B, T)."}],
    }
    with build_client(monkeypatch, KeyedStore(), settings) as client:
        response = client.post("/reason", json=body)

    assert response.status_code == 200
    payload = response.json()
    # Keys are lower-cased because `add_fact` normalises constants that way,
    # so the label table has to fold case to match the facts it explains.
    assert payload["labels"]["db00945"] == "Aspirin"
    assert payload["labels"]["p23219"] == "COX-1"
    assert payload["node_types"]["db00945"] == "Drug"
    # The facts keep using keys, so the two concerns stay separate.
    assert any("db00945" in fact for fact in payload["derived"])


def test_reason_omits_labels_when_facts_come_from_the_request(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """No graph was read, so there is nothing to label — omit rather than guess."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.post("/reason", json={"facts": [{"fact": "parent(tom, bob)"}]})

    assert response.status_code == 200
    assert response.json()["labels"] == {}


# --- /resolve --------------------------------------------------------------


def test_resolve_finds_a_drug_by_name(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, KeyedStore(), settings) as client:
        response = client.post("/resolve", json={"name": "Aspirin"})

    assert response.status_code == 200
    body = response.json()
    assert body["match_count"] == 1
    assert body["matches"][0]["key"] == "DB00945"
    assert body["matches"][0]["type"] == "Drug"
    assert body["ambiguous"] is False


def test_resolve_is_case_insensitive(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, KeyedStore(), settings) as client:
        response = client.post("/resolve", json={"name": "aSpIrIn"})

    assert response.json()["match_count"] == 1


def test_resolve_reports_ambiguity_rather_than_picking_one(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Target names repeat across species, so a name can map to several terms.

    Silently returning the first would look confident and be wrong.
    """

    class AmbiguousStore(StubStore):
        def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
            if "MATCH (n)" in query:
                return {
                    "success": True,
                    "records": [
                        {
                            "id": 1,
                            "labels": ["Protein"],
                            "props": {
                                "uniprot_id": "P1",
                                "name": "Beta-lactamase",
                                "species": "E. coli",
                            },
                        },
                        {
                            "id": 2,
                            "labels": ["Protein"],
                            "props": {
                                "uniprot_id": "P2",
                                "name": "Beta-lactamase",
                                "species": "K. pneumoniae",
                            },
                        },
                    ],
                }
            return {"success": True, "records": []}

    with build_client(monkeypatch, AmbiguousStore(), settings) as client:
        response = client.post("/resolve", json={"name": "Beta-lactamase"})

    body = response.json()
    assert body["match_count"] == 2
    assert body["ambiguous"] is True
    assert {m["key"] for m in body["matches"]} == {"P1", "P2"}


def test_resolve_returns_no_matches_for_an_unknown_name(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, KeyedStore(), settings) as client:
        response = client.post("/resolve", json={"name": "Nonexistent"})

    assert response.status_code == 200
    body = response.json()
    assert body["match_count"] == 0
    assert body["matches"] == []
    assert body["ambiguous"] is False


def test_resolve_rejects_a_blank_name(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, KeyedStore(), settings) as client:
        response = client.post("/resolve", json={"name": "   "})

    assert response.status_code == 422


def test_resolve_matches_on_a_gene_name(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A caller may know the gene, not the protein name."""

    class GeneStore(StubStore):
        def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
            if "MATCH (n)" in query:
                return {
                    "success": True,
                    "records": [
                        {
                            "id": 1,
                            "labels": ["Protein"],
                            "props": {
                                "uniprot_id": "P23219",
                                "name": "Prostaglandin G/H synthase 1",
                                "gene_name": "PTGS1",
                            },
                        }
                    ],
                }
            return {"success": True, "records": []}

    with build_client(monkeypatch, GeneStore(), settings) as client:
        response = client.post("/resolve", json={"name": "PTGS1"})

    assert response.json()["match_count"] == 1

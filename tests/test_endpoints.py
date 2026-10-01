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
from conftest import TEST_API_TOKEN
from fastapi.testclient import TestClient

from semantica_service import main
from semantica_service.config import Settings
from semantica_service.reasoning import build_query, load_library


class StubStore:
    """Neo4j store stand-in driven by canned stats and query results.

    The default stats carry every relationship type the shipped rule library
    consumes, because startup verifies the library against this vocabulary: a
    stub reporting a narrower graph would (correctly) stop the app from booting,
    which is a property of the rules rather than of whatever a test is checking.

    Every statement and its parameters are recorded, so a test can assert that a
    caller-supplied value was *bound* rather than interpolated into the query
    text — the difference between data and code.
    """

    def __init__(self, stats: dict[str, Any] | None = None) -> None:
        self.queries: list[str] = []
        self.parameters: list[Any] = []
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
        self.queries.append(query)
        self.parameters.append(parameters)
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


class RuleStore(StubStore):
    """A store whose rule queries return prepared rows.

    Rules are Cypher against the graph, so a reasoning test supplies the rows the
    rule's join would produce.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        names: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__()
        self._rows = rows or []
        # What the display-name lookup returns for the conclusion endpoints.
        # Defaulted to a resolving map so most tests exercise the reasoning
        # rather than the labelling.
        self._names = (
            names
            if names is not None
            else [
                {"key": "DB00945", "name": "Aspirin", "type": "Drug"},
                {"key": "DB00682", "name": "Warfarin", "type": "Drug"},
            ]
        )

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        # The rule joins are the only statements that project premise ids.
        if "premise_1" in query:
            self.queries.append(query)
            self.parameters.append(parameters)
            return {"success": True, "records": list(self._rows)}
        if "coalesce(n.drugbank_id" in query:
            self.queries.append(query)
            self.parameters.append(parameters)
            return {"success": True, "records": list(self._names)}
        return super().execute_query(query, parameters)


class ScopedStore(StubStore):
    """A store that mimics scope resolution, including its lookups.

    Scope resolution reads Drug / ATCClass nodes by name or code before the rule
    runs, so a stub that only knows the rule query would make every scope look
    empty.
    """

    def __init__(self, *, matching: bool) -> None:
        super().__init__()
        self._matching = matching

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        if "toLower(d.name) IN wanted" in query:
            self.queries.append(query)
            self.parameters.append(parameters)
            if not self._matching:
                return {"success": True, "records": []}
            return {"success": True, "records": [{"key": "DB00945", "name": "Aspirin"}]}
        if "c.code STARTS WITH $prefix" in query:
            self.queries.append(query)
            self.parameters.append(parameters)
            return {"success": True, "records": [{"key": "L01XX29", "name": "L01XX29"}]}
        if "UNWIND $codes" in query:
            self.queries.append(query)
            self.parameters.append(parameters)
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
    return Settings(neo4j_database="neo4j", api_token=TEST_API_TOKEN)


def build_client(
    monkeypatch: pytest.MonkeyPatch, store: StubStore, settings: Settings
) -> TestClient:
    """An authenticated client, since every route but /health now requires it.

    The token is supplied as a client-wide default header rather than at each
    call site: these tests are about the reasoning contract, and threading a
    credential through forty requests would bury it. Authentication itself is
    covered in `test_auth.py`, including the unauthenticated cases.
    """
    monkeypatch.setattr(main, "StorePool", lambda _settings: StubPool(store))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return TestClient(main.create_app(), headers={"Authorization": f"Bearer {TEST_API_TOKEN}"})


# --- /schema ---------------------------------------------------------------


def test_schema_lists_labels_and_types(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.get("/schema")

    assert response.status_code == 200
    body = response.json()
    assert body["graph"] == "neo4j"
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


def reason_rule(**overrides: Any) -> dict[str, Any]:
    """A valid reasoning request: one reviewed rule over the whole graph."""
    payload: dict[str, Any] = {
        "load_from_graph": True,
        "scope_all": True,
        "intent": "shared_target",
    }
    payload.update(overrides)
    return payload


def test_reason_applies_the_named_rule(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """The rule's Cypher runs and its rows become derived facts."""
    rows = [
        {
            "subject": "DB00945",
            "object": "DB01050",
            "premise_1": "lucent:a",
            "premise_2": "lucent:b",
        },
    ]
    with build_client(monkeypatch, RuleStore(rows), settings) as client:
        response = client.post("/reason", json=reason_rule())

    assert response.status_code == 200
    body = response.json()
    assert body["fact_count"] == 1
    assert body["derived"] == ["shares_target(DB00945, DB01050)"]


def test_reason_requires_load_from_graph(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The rules read the graph, so an unset flag is a caller error.

    Not defaulting it to true is deliberate: a caller written against the old
    contract would otherwise receive an empty result and read it as a negative
    finding rather than as a request that never reached the graph.
    """
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json={"intent": "shared_target"})

    assert response.status_code == 422
    assert "load_from_graph" in response.json()["detail"]


def test_reason_requires_a_rule(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """Without a named rule there is nothing to evaluate."""
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json={"load_from_graph": True, "scope_all": True})

    assert response.status_code == 422
    assert "intent" in response.json()["detail"]


def test_graph_backed_reason_requires_a_scope(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Reasoning over an unstated slice cannot distinguish absent from false.

    "Not derived" is the only answer a rule can give for "not present", and it
    carries information only if the caller knows what was looked at.
    """
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json={"load_from_graph": True, "intent": "shared_target"})

    assert response.status_code == 422
    assert "scope" in response.json()["detail"]


def test_graph_backed_reason_echoes_the_range_it_looked_at(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The response states the extent, which is what makes an empty result readable."""
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    reason_range = body["range"]
    assert reason_range["scope"] == "all"


def test_a_scope_that_matches_nothing_is_refused_not_answered(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """ "No derivations" for an empty scope is a statement about nobody.

    Returning an empty result would let a typo'd drug name read as a clean
    negative finding.
    """
    payload = {
        "load_from_graph": True,
        "intent": "shared_target",
        "scope": {"drug_names": ["NotADrug"]},
    }
    with build_client(monkeypatch, ScopedStore(matching=False), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422
    detail = response.json()["detail"]
    # The reason is structured, not just a message: a client has to branch on
    # this case, because it is the one refusal that resembles an answer.
    assert detail["kind"] == "scope_matched_nothing"
    assert "matched nothing" in detail["message"]
    assert detail["drug_names"] == ["NotADrug"]


def test_a_scope_resolves_to_drug_keys_and_is_echoed(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A scope named in drug names is resolved into the keys the rule binds."""
    payload = {
        "load_from_graph": True,
        "intent": "shared_target",
        "scope": {"drug_names": ["Aspirin"]},
    }
    store = ScopedStore(matching=True)
    with build_client(monkeypatch, store, settings) as client:
        body = client.post("/reason", json=payload).json()

    assert body["range"]["drug_keys"] == ["DB00945"]


def test_the_scope_is_bound_as_a_parameter_not_interpolated(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A drug id comes from the request, so it is data and must be bound.

    Interpolating it would make the request body a route to arbitrary Cypher in
    exactly the endpoint that is supposed to be evaluating reviewed rules.
    """
    payload = {
        "load_from_graph": True,
        "intent": "shared_target",
        "scope": {"drug_names": ["Aspirin"]},
    }
    store = ScopedStore(matching=True)
    with build_client(monkeypatch, store, settings) as client:
        client.post("/reason", json=payload)

    # The scope must have been sent as a bound parameter, and the literal id must
    # not appear in the rule's query text: a drug id comes from the request, so
    # interpolating it would make the body a route to arbitrary Cypher.
    bound = [p for p in store.parameters if p and "seed_keys" in p]
    assert bound, "the scope was not passed as a parameter"
    rule_queries = [q for q in store.queries if "premise_1" in q]
    assert rule_queries, "the rule query was never sent"
    assert all("DB00945" not in q for q in rule_queries)


def test_reason_names_the_rule_it_applied(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A conclusion is only attributable if the response names the reviewed rule."""
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    assert body["rule"]["id"] == "shared_target_pair"
    assert body["rule"]["intent"] == "shared_target"
    assert body["rule"]["derives"] == "shares_target"


def test_a_conclusion_is_marked_derived_not_asserted(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    rows = [{"subject": "DB1", "object": "DB2", "premise_1": "lucent:x", "premise_2": "lucent:y"}]
    with build_client(monkeypatch, RuleStore(rows), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    conclusion = body["conclusions"][0]
    assert conclusion["verifiability"] == "derived"
    assert conclusion["predicate"] == "shares_target"
    assert conclusion["subject"] == "DB1"
    assert conclusion["object"] == "DB2"


def test_a_conclusion_carries_the_provenance_of_both_premises(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Citations come from the same query as the conclusion, not a second pass."""
    rows = [
        {
            "subject": "DB1",
            "object": "DB2",
            "premise_1": "lucent:drugbank_drug_targets/DB1/P/all/ACTS_ON",
            "premise_2": "lucent:drugbank_drug_targets/DB2/P/all/ACTS_ON",
        }
    ]
    with build_client(monkeypatch, RuleStore(rows), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    citations = body["conclusions"][0]["citations"]
    assert len(citations) == 2
    assert "DB1" in citations[0] and "DB2" in citations[1]


def test_the_answer_carries_names_for_the_identifiers_it_returns(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A conclusion is returned as identifiers, so the names must come with it.

    `potential_ddi(DB00682, DB00188)` is not something a caller can show a user.
    These maps used to be built by exporting the whole graph; the rewrite left
    them hardcoded empty, so the endpoint answered with bare ids and no way to
    render them. Nothing failed — the response was well-formed and simply
    unusable — which is why this is pinned.
    """
    rows = [{"subject": "DB00945", "object": "DB00682", "premise_1": "p", "premise_2": "q"}]
    with build_client(monkeypatch, RuleStore(rows), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    assert body["labels"] == {"DB00945": "Aspirin", "DB00682": "Warfarin"}
    assert body["node_types"] == {"DB00945": "Drug", "DB00682": "Drug"}


def test_only_the_returned_endpoints_are_looked_up(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The lookup is bounded by the answer, not by the graph.

    Labelling by exporting the graph pulled thousands of nodes to name a handful
    of ids; on a scope returning three conclusions almost all of it was waste.
    """
    rows = [{"subject": "DB00945", "object": "DB00682", "premise_1": "p", "premise_2": "q"}]
    store = RuleStore(rows)
    with build_client(monkeypatch, store, settings) as client:
        client.post("/reason", json=reason_rule())

    lookup = [p for q, p in zip(store.queries, store.parameters, strict=False) if "coalesce" in q]
    assert lookup, "the display-name lookup did not run"
    assert lookup[0]["keys"] == ["DB00682", "DB00945"]


def test_a_missing_name_does_not_fail_the_answer(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Labelling is a convenience; losing it must not cost the conclusions.

    An unresolvable key is reported by omission so the client falls back to the
    identifier, rather than turning a correct answer into an error.
    """
    rows = [{"subject": "DB00945", "object": "DB00682", "premise_1": "p", "premise_2": "q"}]
    store = RuleStore(rows, names=[{"key": "DB00945", "name": "Aspirin", "type": "Drug"}])
    with build_client(monkeypatch, store, settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    assert body["fact_count"] == 1
    assert body["labels"] == {"DB00945": "Aspirin"}
    assert "DB00682" not in body["labels"]


def test_a_conclusion_missing_a_premise_says_so_rather_than_hiding_it(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A conclusion resting on uncitable evidence is still a conclusion.

    Dropping the gap would present it as fully supported.
    """
    rows = [{"subject": "DB1", "object": "DB2", "premise_1": "lucent:x", "premise_2": None}]
    with build_client(monkeypatch, RuleStore(rows), settings) as client:
        body = client.post("/reason", json=reason_rule()).json()

    conclusion = body["conclusions"][0]
    assert conclusion["citations"] == ["lucent:x"]
    assert conclusion["uncited_premises"]


def test_a_scoped_rule_is_restricted_to_the_named_drug_not_its_neighbours(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The scope is the drug the caller named, not the 501 keys it expands to.

    Measured regression: naming Warfarin resolves to ~501 drug keys (its
    interaction partners), and scoping the rule to that whole set returned 500
    shared-target pairs for a drug that has 26. The neighbours' own pairs are not
    pairs involving Warfarin, and they swamped the answer — a scoped request that
    looked like it worked.
    """
    payload = {
        "load_from_graph": True,
        "intent": "shared_target",
        "scope": {"drug_names": ["Aspirin"]},
    }
    store = ScopedStore(matching=True)
    with build_client(monkeypatch, store, settings) as client:
        client.post("/reason", json=payload)

    rule_calls = [
        (q, p) for q, p in zip(store.queries, store.parameters, strict=False) if "premise_1" in q
    ]
    assert rule_calls, "the rule query was never sent"
    query, params = rule_calls[0]
    # The rule is scoped to the seed the caller named...
    assert params and params.get("seed_keys") == ["DB00945"]
    # ...and it is the seed list that is bound, not the neighbour expansion.
    assert "drug_keys" not in (params or {})
    # The literal id must not appear in the query text: a drug id comes from the
    # request, so interpolating it would make the body a route to arbitrary Cypher.
    assert "DB00945" not in query


def test_the_rule_scopes_on_either_endpoint(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """A partner may be either the subject or the object of a conclusion.

    Restricting to one side would silently halve every symmetric rule's output.
    """
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        client.post(
            "/reason",
            json={
                "load_from_graph": True,
                "intent": "shared_target",
                "scope": {"drug_names": ["Aspirin"]},
            },
        )

    rule = load_library().by_id("shared_target_pair")
    assert rule is not None
    query, _ = build_query(rule, seed_keys=("DB00945",))
    assert "a." in query and "b." in query
    assert "$seed_keys" in query


def test_reason_refuses_an_unknown_intent(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json=reason_rule(intent="not_a_rule"))

    assert response.status_code == 422
    assert "No rule named" in response.json()["detail"]


def test_reason_refuses_both_intent_and_rule_id(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post(
            "/reason", json=reason_rule(intent="shared_target", rule_id="shared_target_pair")
        )

    assert response.status_code == 422
    assert "at most one" in response.json()["detail"]


def test_reason_accepts_a_rule_by_id(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post(
            "/reason",
            json={"load_from_graph": True, "scope_all": True, "rule_id": "shared_target_pair"},
        )

    assert response.status_code == 200
    assert response.json()["rule"]["id"] == "shared_target_pair"


def test_request_supplied_rules_are_no_longer_accepted(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """The Datalog evaluator is gone, so the field is gone.

    Accepting and ignoring it would answer a question the caller did not ask —
    it sent a rule and would receive the library rule's output.
    """
    payload = reason_rule(rules=[{"rule": "ancestor(X, Y) :- parent(X, Y)."}])
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422


def test_request_supplied_facts_are_no_longer_accepted(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    payload = reason_rule(facts=[{"fact": "parent(tom, bob)"}])
    with build_client(monkeypatch, RuleStore([]), settings) as client:
        response = client.post("/reason", json=payload)

    assert response.status_code == 422


def test_the_declared_fact_budget_is_enforced(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """`max_reasoning_facts` has to refuse work, not just be configurable."""
    small = settings.model_copy(update={"max_reasoning_facts": 1})
    rows = [
        {"subject": "DB1", "object": "DB2", "premise_1": "lucent:a", "premise_2": "lucent:b"},
        {"subject": "DB3", "object": "DB4", "premise_1": "lucent:c", "premise_2": "lucent:d"},
    ]
    with build_client(monkeypatch, RuleStore(rows), small) as client:
        response = client.post("/reason", json=reason_rule())

    assert response.status_code == 422
    assert response.json()["detail"]["kind"] == "fact_limit_exceeded"


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

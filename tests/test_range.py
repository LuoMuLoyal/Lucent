"""Scope resolution: a named scope becomes a bounded, ordered key set.

The bridge's correctness rests on the scope being explicit and deterministic.
These tests pin the two properties that are easy to get wrong and expensive to
get wrong: the expansion is exactly one hop, and every resolution query is
ordered before it is limited.
"""

from __future__ import annotations

from typing import Any

import pytest

from semantica_service.graph.range import ScopeSpec, resolve_scope


class RecordingStore:
    """Serves the queries scope resolution issues, recording them.

    Each canned result is keyed by a fragment of the query, so a test states
    what the graph contains and the resolver decides what to ask for.
    """

    def __init__(self, results: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self._results = results or {}
        self.queries: list[tuple[str, dict[str, Any]]] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.queries.append((query, parameters or {}))
        for fragment, records in self._results.items():
            if fragment in query:
                return {"success": True, "records": records}
        return {"success": True, "records": []}

    def query_for(self, fragment: str) -> tuple[str, dict[str, Any]]:
        for query, parameters in self.queries:
            if fragment in query:
                return query, parameters
        raise AssertionError(f"no query contained {fragment!r}")


def test_an_empty_spec_resolves_to_nothing_without_touching_the_graph() -> None:
    """An empty scope is the absence of one, not a request for everything."""
    store = RecordingStore()
    resolved = resolve_scope(store, ScopeSpec())

    assert resolved.is_empty
    assert store.queries == []


def test_every_resolution_query_is_ordered_before_it_limits() -> None:
    """An unordered LIMIT returns a different set on every run.

    That is the defect this whole module exists to remove, and it would come
    straight back in through a resolution query.
    """
    store = RecordingStore(
        {
            "toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}],
        }
    )
    resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    assert store.queries
    for query, _ in store.queries:
        assert "ORDER BY" in query, f"unordered query would be non-deterministic: {query}"


def test_the_expansion_is_one_hop_not_a_transitive_closure() -> None:
    """A partner's partners must not be reachable.

    Warfarin interacts with 530 drugs; one more hop pulls in most of the graph
    and the scope stops being a bound at all. Measured: the two-hop version
    loaded 1,291 nodes where the one-hop version loads 541.
    """
    store = RecordingStore(
        {
            "toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}],
            "MATCH (a:Drug {drugbank_id: seed})": [{"key": "DB00005", "name": "Partner"}],
        }
    )
    resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    # The expansion reads the seed list once, and the seed list is what the
    # caller named — not the seed list plus what the first hop returned.
    _, parameters = store.query_for("MATCH (a:Drug {drugbank_id: seed})")
    assert parameters["keys"] == ["DB00682"], "expansion was fed its own output"


def test_seeds_and_neighbours_are_reported_apart() -> None:
    """ "The scope is warfarin" and "warfarin plus 530 partners" differ."""
    store = RecordingStore(
        {
            "toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}],
            "MATCH (a:Drug {drugbank_id: seed})": [{"key": "DB00005", "name": "Partner"}],
        }
    )
    resolved = resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    assert resolved.seed_drug_keys == ["DB00682"]
    assert resolved.drug_keys == ["DB00005", "DB00682"]


def test_an_interaction_is_read_in_both_directions() -> None:
    """The source data is single-directional, so one direction loses the answer.

    Only 4,218 of 19,842 interaction rows name a drug on the source side. Read
    one way only, warfarin — the most asked-about drug here — has no
    interactions at all, and the reasoning input would be empty for it.
    """
    store = RecordingStore({"toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}]})
    resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    outgoing = store.query_for(")-[:INTERACTS_WITH]->(b:Drug)")
    incoming = store.query_for("->(b:Drug {drugbank_id: seed})")
    # Seeds are pinned in the pattern rather than filtered afterwards: a WHERE
    # on the seed would make the LIMIT bound the wrong population, since the
    # scan would start at every drug rather than at the named one.
    assert "a:Drug {drugbank_id: seed}" in outgoing[0]
    assert "b:Drug {drugbank_id: seed}" in incoming[0]


def test_an_atc_prefix_pulls_in_its_classes_and_member_drugs() -> None:
    """A caller who names a class means the drugs in it."""
    store = RecordingStore(
        {
            "c.code STARTS WITH $prefix": [{"key": "L01XX29", "name": "L01XX29"}],
            "UNWIND $codes AS code": [{"key": "DB00004", "name": "Drug"}],
        }
    )
    resolved = resolve_scope(store, ScopeSpec(atc_prefixes=("L01",), limit=100))

    assert resolved.atc_keys == ["L01XX29"]
    assert resolved.drug_keys == ["DB00004"]


def test_a_resolution_that_hits_its_bound_says_so() -> None:
    """A silently capped scope is the same false-negative machine as a slice."""
    store = RecordingStore(
        {
            "toLower(d.name) IN $names": [
                {"key": "DB00001", "name": "A"},
                {"key": "DB00002", "name": "B"},
            ]
        }
    )
    resolved = resolve_scope(store, ScopeSpec(drug_names=("a",), limit=2))

    assert resolved.truncated is True


def test_a_missing_drug_resolves_to_an_empty_scope_not_an_error() -> None:
    """The caller decides what an unresolved scope means; the resolver reports."""
    store = RecordingStore()
    resolved = resolve_scope(store, ScopeSpec(drug_names=("NotADrug",), limit=100))

    assert resolved.is_empty
    assert resolved.seed_drug_keys == []


def test_a_drug_reachable_twice_appears_once() -> None:
    """Duplicates would overstate the scope in the echoed range."""
    store = RecordingStore(
        {
            "toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}],
            "MATCH (a:Drug {drugbank_id: seed})": [{"key": "DB00682", "name": "Warfarin"}],
        }
    )
    resolved = resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    assert resolved.drug_keys == ["DB00682"]


def test_labels_fold_case_to_match_the_facts() -> None:
    """`add_fact` lower-cases constants, so the label map has to fold too."""
    store = RecordingStore({"toLower(d.name) IN $names": [{"key": "DB00682", "name": "Warfarin"}]})
    resolved = resolve_scope(store, ScopeSpec(drug_names=("warfarin",), limit=100))

    assert resolved.labels == {"db00682": "Warfarin"}


def test_a_failed_resolution_raises_rather_than_looking_empty() -> None:
    """An empty scope and an unreadable one must not look the same."""

    class FailingStore:
        def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
            return {"success": False, "error": "boom"}

    with pytest.raises(RuntimeError, match="boom"):
        resolve_scope(FailingStore(), ScopeSpec(drug_names=("warfarin",), limit=100))

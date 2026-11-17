"""The AGE → semantica bridge.

``DatalogReasoner.load_from_graph`` explicitly rejects graph-store handles, so
this adapter is what makes graph-backed inference possible at all. Its output
must match the dict shapes ``add_fact`` accepts, which is what these tests pin.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from semantica_service.graph.export import GraphExport, _first_label, _turtle_literal


def _page_limit(query: str) -> int | None:
    """Read the LIMIT a paged query asked for, so stubs can honour it."""
    match = re.search(r"LIMIT (\d+)", query)
    return int(match.group(1)) if match else None


class StubStore:
    """Returns canned AGE results per query kind.

    The real bridge pages its reads, so a stub must too: a double that always
    returns every canned row regardless of the requested page size would let a
    paging bug through, and paging is what makes the export deterministic.
    """

    def __init__(
        self,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        fail: bool = False,
    ) -> None:
        self._nodes = nodes
        self._edges = edges
        self._fail = fail
        self.queries: list[str] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.queries.append(query)
        if self._fail:
            return {"success": False, "error": "boom"}
        records = self._nodes if "MATCH (n)" in query else self._edges
        # The real bridge pages by re-running an ordered query with a page
        # size; honouring it here keeps a paging bug from hiding behind a stub
        # that always returns everything.
        limit = _page_limit(query)
        return {"success": True, "records": records[:limit] if limit else records}


class StubRangeStore:
    """Serves the node and edge queries the scoped export issues.

    ``population`` is how many rows exist in the graph. A query returns the
    smaller of the ``LIMIT`` it asked for and that population — the same
    contract AGE offers — so ``page_size`` is what drives the paging loop and
    ``population`` is what decides where it stops.

    ``edge_population`` defaults to ``population``. It is separate because the
    export mirrors one-directional interaction edges, and a test measuring the
    *node* read should not have its limits consumed by the edge mirror.

    ``hard_cap`` models a store that ignores ``LIMIT`` and always returns the
    same rows. Nothing in the protocol forbids it, and a paging loop that
    assumed otherwise would spin forever rather than fail.
    """

    def __init__(
        self,
        population: int,
        batch: int | None = None,
        hard_cap: int | None = None,
        edge_population: int | None = None,
    ) -> None:
        self._population = population
        self._edge_population = population if edge_population is None else edge_population
        self._batch = batch
        self._hard_cap = hard_cap
        #: Return every matching row regardless of the LIMIT asked for. Models a
        #: store that ignores it, which nothing in the protocol forbids.
        self.ignore_limit = False
        self.queries: list[str] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.queries.append(query)
        exists = self._population if "MATCH (n)" in query else self._edge_population
        if self._hard_cap is not None:
            served = min(self._hard_cap, exists)
        elif self.ignore_limit:
            served = exists
        else:
            asked = _page_limit(query) or exists
            served = min(asked, exists)
            if self._batch is not None:
                served = min(served, self._batch)
        if "MATCH (n)" in query:
            rows: list[dict[str, Any]] = [
                {
                    "id": i,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": f"DB{i:05d}", "name": f"Drug {i}"},
                }
                for i in range(served)
            ]
        else:
            rows = [
                {
                    "rel_id": i,
                    "source": i,
                    "target": i + 1,
                    "rel_type": "INTERACTS_WITH",
                    "props": {"prov": f"lucent:row/{i}"},
                    "source_props": {"drugbank_id": f"DB{i:05d}"},
                    "target_props": {"drugbank_id": f"DB{i + 1:05d}"},
                }
                for i in range(served)
            ]
        return {"success": True, "records": rows}


def test_nodes_use_a_business_key_not_the_row_id() -> None:
    """Facts built from AGE row ids are correct but unreadable.

    `add_fact` prefers a dict's `id`, so the export must put a business
    identifier there — otherwise every derived fact reads
    `shares_target(844424930131970, ...)`.
    """
    store = StubStore(nodes=[{"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}}], edges=[])
    export = GraphExport(store, limit=10)

    node = next(iter(export.find_nodes()))
    assert node["id"] == "Aspirin"
    assert node["type"] == "Drug"
    assert node["properties"] == {"name": "Aspirin"}
    # The row id stays reachable for mapping a fact back to the graph element.
    assert node["graph_id"] == "1"


def test_nodes_prefer_a_canonical_identifier_over_the_name() -> None:
    store = StubStore(
        nodes=[
            {
                "id": 1,
                "labels": ["Drug"],
                "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
            }
        ],
        edges=[],
    )
    export = GraphExport(store, limit=10)

    assert next(iter(export.find_nodes()))["id"] == "DB00945"


def test_a_scoped_edge_needs_only_one_endpoint_in_scope() -> None:
    """The scope is a neighbourhood, not an intersection.

    A caller names drugs one at a time, so requiring both endpoints of an edge
    to be named would make every scope edge-free — and an edge-free fact base
    derives nothing whatever the rules say. Measured against the real graph:
    warfarin is cited by 530 interaction rows and cites none of its own.
    """
    store = StubStore(nodes=[], edges=[])
    GraphExport(store, limit=10, drug_keys=["DB00682"], scope_label="explicit")

    edge_queries = [q for q in store.queries if "MATCH (a)-[r]->(b)" in q]
    assert edge_queries
    # `OR` between the two endpoints: either side may carry the scope key.
    assert all(
        "a.drugbank_id IN $drug_keys OR b.drugbank_id IN $drug_keys" in q for q in edge_queries
    )


def test_scope_keys_reach_the_node_query_for_both_drugs_and_proteins() -> None:
    """A scope key set holds drug ids and protein (UniProt) ids alike.

    The neighbourhood expansion resolves both into one list, and both become
    Datalog constants, so the node read has to recognise either property name.
    """
    store = StubStore(nodes=[], edges=[])
    GraphExport(store, limit=10, drug_keys=["P23219"], scope_label="explicit")

    node_queries = [q for q in store.queries if "MATCH (n)" in q]
    assert node_queries
    assert all("n.uniprot_id IN $drug_keys" in q for q in node_queries)


def test_nodes_fall_back_to_the_row_id_when_no_business_key_exists() -> None:
    store = StubStore(nodes=[{"id": 7, "labels": ["Thing"], "props": {}}], edges=[])
    export = GraphExport(store, limit=10)

    assert next(iter(export.find_nodes()))["id"] == "7"


def test_edges_resolve_endpoints_through_the_same_key_as_nodes() -> None:
    """If the two disagree, edge facts never join to node facts."""
    store = StubStore(
        nodes=[
            {"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}},
            {"id": 2, "labels": ["Protein"], "props": {"name": "COX-1"}},
        ],
        edges=[
            {
                "source": 1,
                "target": 2,
                "rel_type": "TARGETS",
                "props": {},
                "source_props": {"name": "Aspirin"},
                "target_props": {"name": "COX-1"},
            }
        ],
    )
    export = GraphExport(store, limit=10)

    edge = next(iter(export.find_edges()))
    node_keys = {node["id"] for node in export.find_nodes()}
    assert edge["source"] in node_keys
    assert edge["target"] in node_keys
    assert edge["source"] == "Aspirin"
    assert edge["type"] == "TARGETS"


def test_agtype_properties_arriving_as_json_text_are_parsed() -> None:
    """AGE returns properties as an agtype string under some drivers."""
    store = StubStore(
        nodes=[{"id": 1, "labels": ["Drug"], "props": '{"name": "Aspirin", "mw": 180}'}],
        edges=[],
    )
    export = GraphExport(store, limit=10)

    assert next(iter(export.find_nodes()))["properties"] == {"name": "Aspirin", "mw": 180}


def test_malformed_agtype_degrades_to_empty_rather_than_raising() -> None:
    store = StubStore(nodes=[{"id": 1, "labels": ["Drug"], "props": "not json"}], edges=[])
    export = GraphExport(store, limit=10)

    assert next(iter(export.find_nodes()))["properties"] == {}


def test_rows_without_ids_are_skipped() -> None:
    """A node with no id cannot be referenced by an edge, so it is unusable."""
    store = StubStore(nodes=[{"id": None, "labels": ["Drug"], "props": {}}], edges=[])
    export = GraphExport(store, limit=10)

    assert export.node_count == 0


@pytest.mark.parametrize(
    ("labels", "expected"),
    [
        (["Drug"], "Drug"),
        (["Drug", "Compound"], "Drug"),
        ([], "entity"),
        (None, "entity"),
        ('["Drug"]', "Drug"),
    ],
)
def test_first_label_picks_deterministically(labels: Any, expected: str) -> None:
    assert _first_label(labels) == expected


def test_export_failure_surfaces_rather_than_returning_empty() -> None:
    """A failed export must not look like an empty graph.

    An empty result would let inference silently run over nothing, which is the
    exact failure mode the load_from_graph fork fix addresses.
    """
    with pytest.raises(RuntimeError, match="boom"):
        GraphExport(StubStore(nodes=[], edges=[], fail=True), limit=10)


class TestDeterministicRange:
    """The export must be reproducible, and must say how far it reached.

    Datalog has no negation, so "not derived" is its only answer for "not
    present" — and that answer means nothing unless the caller knows what was
    loaded. Two properties follow, and both are tested here: the same request
    loads the same set, and the response states the extent it reached.
    """

    def test_every_query_orders_before_it_limits(self) -> None:
        """LIMIT without ORDER BY is a random sample, not a prefix.

        This is the defect the reasoning bridge was built to remove: the old
        queries took `LIMIT` on an unordered match, so two identical requests
        loaded different edges (measured: ~23% of 211,630, differing per run).
        """
        store = StubRangeStore(population=1)
        GraphExport(store, limit=10)

        assert store.queries
        for query in store.queries:
            assert "ORDER BY" in query, f"unordered query would be non-deterministic: {query}"

    def test_a_short_page_is_complete_and_a_full_one_is_truncated(self) -> None:
        """`truncated` is what stops an absent derivation reading as a finding.

        Edges are held at zero so the node read is what is measured: the export
        mirrors one-directional edges, and a mirror competing for the same limit
        would make this test about mirroring rather than about truncation.
        """
        complete = GraphExport(StubRangeStore(population=1, edge_population=0), limit=10)
        assert complete.truncated is False
        assert complete.node_count == 1

        # Exactly the limit is not truncation: the export probes one row past
        # it, finds nothing, and reports a complete answer.
        exact = GraphExport(StubRangeStore(population=100, edge_population=0), limit=100)
        assert exact.truncated is False
        assert exact.node_count == 100

        # One row more than the limit is truncation, and saying so is what keeps
        # a conclusion drawn from a slice from being presented as if it covered
        # the whole graph.
        cut = GraphExport(StubRangeStore(population=101, edge_population=0), limit=100)
        assert cut.truncated is True
        assert cut.node_count == 100

    def test_one_query_reads_the_whole_limit(self) -> None:
        """The read is one query, not one per page.

        It used to grow the LIMIT on every round trip so page boundaries would
        line up without OFFSET. That is correct but quadratic: loading 50,000
        edges took 25 queries of increasing size, each re-reading everything the
        last had returned, and measured 57 seconds against 0.3 for the single
        equivalent query. The driver materialises every row either way, so the
        extra round trips bought nothing back.
        """
        store = StubRangeStore(population=120, edge_population=0)
        export = GraphExport(store, limit=120)

        assert export.node_count == 120
        node_queries = [q for q in store.queries if "MATCH (n)" in q]
        assert len(node_queries) == 2, (
            f"expected one read plus one truncation probe, got {len(node_queries)}"
        )

    def test_the_read_asks_for_exactly_the_limit(self) -> None:
        """Asking for more than the limit would spend work the caller declined."""
        store = StubRangeStore(population=500, edge_population=0)
        GraphExport(store, limit=120)

        limits = [n for q in store.queries if "MATCH (n)" in q if (n := _page_limit(q)) is not None]

        # The read asks for 120; the truncation probe asks for one more, which
        # is the smallest question that can distinguish "exactly 120" from "more
        # than 120".
        assert limits == [120, 121], f"unexpected limits: {limits}"

    def test_a_population_beyond_the_limit_is_reported_as_truncated(self) -> None:
        store = StubRangeStore(population=500)
        export = GraphExport(store, limit=120)

        assert export.node_count == 120
        assert export.truncated is True

    def test_a_store_that_ignores_the_limit_cannot_spin_the_request(self) -> None:
        """A store that over-delivers must not make the read unbounded.

        Nothing in the protocol guarantees a store honours LIMIT. With paging
        this was a loop that never advanced; now the result is sliced back to
        the limit, so an over-delivering store cannot put more into the reasoner
        than the caller allowed, and the range it echoes stays true.
        """
        store = StubRangeStore(population=500, edge_population=0)
        store.execute_ignoring_limit = True  # type: ignore[attr-defined]
        export = GraphExport(store, limit=120)

        assert export.node_count == 120
        assert export.truncated is True
        assert len(store.queries) < 10, "the read kept asking"

    def test_scope_keys_reach_the_query_as_parameters(self) -> None:
        """A scope is applied in the query, not filtered afterwards.

        Filtering client-side would make LIMIT bound the wrong population: the
        page would be filled with out-of-scope rows that are then discarded.
        """
        captured: list[Any] = []

        class CapturingStore(StubRangeStore):
            def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
                captured.append(parameters)
                return super().execute_query(query, parameters)

        GraphExport(
            CapturingStore(population=1),
            limit=10,
            drug_keys=["DB00945"],
            atc_keys=["L01"],
            scope_label="explicit",
        )

        assert any(p and p.get("drug_keys") == ["DB00945"] for p in captured if p)
        assert any(p and p.get("atc_keys") == ["L01"] for p in captured if p)

    def test_structural_atc_links_are_excluded_from_a_scoped_edge_read(self) -> None:
        """Sharing an ATC code must not drag every sibling drug into scope.

        IN_ATC_CLASS and SUBCLASS_OF are structural: following them turns a
        targeted question into a whole-graph load by way of two hops.
        """
        store = StubRangeStore(population=1)
        GraphExport(store, limit=10, drug_keys=["DB00945"], scope_label="explicit")

        edge_queries = [q for q in store.queries if "MATCH (a)-[r]->(b)" in q]
        assert edge_queries
        assert all("IN_ATC_CLASS" in q and "SUBCLASS_OF" in q for q in edge_queries)

    def test_range_describes_what_was_loaded(self) -> None:
        export = GraphExport(
            StubRangeStore(population=2),
            limit=10,
            drug_keys=["DB00002", "DB00001"],
            scope_label="explicit",
        )
        described = export.range.describe()

        assert described["scope"] == "explicit"
        assert described["drug_count"] == 2
        # Sorted, so the echoed range cannot depend on dictionary order.
        assert described["drug_keys"] == ["DB00001", "DB00002"]
        assert described["truncated"] is False


class TestFactAssertions:
    """A derivation is only auditable through the assertions behind it.

    Datalog returns a predicate over opaque constants. Without a map from each
    premise fact back to the graph edge that asserts it, a conclusion cannot be
    cited, and an uncitable conclusion is indistinguishable from an invented
    one.
    """

    def _export(self) -> GraphExport:
        store = StubStore(
            nodes=[],
            edges=[
                {
                    "rel_id": 10,
                    "source": 1,
                    "target": 2,
                    "rel_type": "INHIBITS",
                    "props": {"prov": "lucent:a/b/1/INHIBITS"},
                    "source_props": {"drugbank_id": "DB00001"},
                    "target_props": {"uniprot_id": "P23219"},
                },
                {
                    "rel_id": 11,
                    "source": 3,
                    "target": 2,
                    "rel_type": "SUBSTRATE_OF",
                    # No prov: the edge is real but uncitable, and saying so is
                    # different from pretending it was never loaded.
                    "props": {},
                    "source_props": {"drugbank_id": "DB00003"},
                    "target_props": {"uniprot_id": "P23219"},
                },
            ],
        )
        return GraphExport(store, limit=10)

    def test_each_edge_fact_maps_to_its_provenance_id(self) -> None:
        assertions = self._export().fact_assertions()

        assert assertions["inhibits(db00001, p23219)"] == "lucent:a/b/1/INHIBITS"
        assert assertions["substrate_of(db00003, p23219)"] is None

    def test_the_key_matches_the_fact_add_fact_builds(self) -> None:
        """The map is useless if its keys disagree with the facts it explains."""
        from semantica.reasoning.datalog_reasoner import DatalogReasoner

        engine = DatalogReasoner()
        for edge in self._export().find_edges():
            engine.add_fact(edge)
        derived = set(engine.derive_all())

        assert set(self._export().fact_assertions()) <= derived


class TestTurtleSerialisation:
    """The SHACL validator consumes Turtle, so it must be well-formed."""

    def test_nodes_and_edges_are_serialised(self) -> None:
        store = StubStore(
            nodes=[
                {"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}},
                {"id": 2, "labels": ["Protein"], "props": {"name": "COX-1"}},
            ],
            edges=[
                {
                    "source": 1,
                    "target": 2,
                    "rel_type": "TARGETS",
                    "props": {},
                    "source_props": {"name": "Aspirin"},
                    "target_props": {"name": "COX-1"},
                }
            ],
        )
        turtle = GraphExport(store, limit=10).to_turtle()

        # Subjects are keyed by the business identifier, so the shape author
        # can reference a node they recognise.
        assert "a lucent:Drug" in turtle
        assert "a lucent:Protein" in turtle
        assert 'lucent:name "Aspirin"' in turtle
        assert "lucent:TARGETS" in turtle

    def test_output_parses_as_turtle(self) -> None:
        """Round-trip through rdflib: the validator will do exactly this."""
        import rdflib

        store = StubStore(
            nodes=[{"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}}],
            edges=[],
        )
        graph = rdflib.Graph()
        graph.parse(data=GraphExport(store, limit=10).to_turtle(), format="turtle")

        assert len(graph) >= 2  # the rdf:type triple plus the name

    def test_property_names_with_spaces_are_sanitised(self) -> None:
        """AGE property keys are arbitrary and would break Turtle."""
        store = StubStore(
            nodes=[{"id": 1, "labels": ["Drug"], "props": {"half life": "2h"}}],
            edges=[],
        )
        turtle = GraphExport(store, limit=10).to_turtle()

        assert "lucent:half_life" in turtle
        assert "lucent:half life" not in turtle

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (True, "true"),
            (False, "false"),
            (180, "180"),
            (1.5, "1.5"),
            (None, '""'),
            ('say "hi"', '"say \\"hi\\""'),
        ],
    )
    def test_literals_are_rendered_correctly(self, value: Any, expected: str) -> None:
        assert _turtle_literal(value) == expected


class TestLabels:
    """Facts are keyed by identifier; a caller needs names to show them.

    Keys must stay stable and unique for Datalog, but `shares_target(db00945,
    db01050)` is not something a user or an assistant can present, so the
    export also exposes the key -> name map.
    """

    def test_labels_map_keys_to_names(self) -> None:
        store = StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                },
                {
                    "id": 2,
                    "labels": ["Protein"],
                    "props": {"uniprot_id": "P23219", "name": "COX-1"},
                },
            ],
            edges=[],
        )
        export = GraphExport(store, limit=10)

        assert export.labels() == {"db00945": "Aspirin", "p23219": "COX-1"}

    def test_label_keys_are_lower_cased_to_match_the_facts(self) -> None:
        """`add_fact` lower-cases constants, so the map must fold case too.

        Otherwise the label table is keyed `DB00945` while every fact reads
        `db00945`, and nothing ever resolves.
        """
        store = StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                }
            ],
            edges=[],
        )

        assert "DB00945" not in GraphExport(store, limit=10).labels()

    def test_labels_fall_back_to_uniprot_title_for_unnamed_targets(self) -> None:
        """Some targets carry no `name`; showing the id would be a regression."""
        store = StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Protein"],
                    "props": {"uniprot_id": "P99999", "uniprot_title": "Unnamed protein"},
                }
            ],
            edges=[],
        )

        assert GraphExport(store, limit=10).labels() == {"p99999": "Unnamed protein"}

    def test_labels_omit_nodes_that_have_no_display_name(self) -> None:
        """An empty string would render as a blank in a UI; omission is honest."""
        store = StubStore(
            nodes=[{"id": 1, "labels": ["Protein"], "props": {"uniprot_id": "P1"}}],
            edges=[],
        )

        assert GraphExport(store, limit=10).labels() == {}

    def test_labels_do_not_overwrite_an_earlier_name_on_key_collision(self) -> None:
        """Two nodes resolving to one key must not produce a shifting name.

        The graph is supposed to have unique keys, so a collision means the
        export is seeing something unexpected; keeping the first is arbitrary
        but deterministic, which is what matters for a stable response.
        """
        store = StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB1", "name": "First"},
                },
                {
                    "id": 2,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB1", "name": "Second"},
                },
            ],
            edges=[],
        )

        assert GraphExport(store, limit=10).labels() == {"db1": "First"}

    def test_node_types_map_keys_to_labels(self) -> None:
        store = StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                }
            ],
            edges=[],
        )

        assert GraphExport(store, limit=10).node_types() == {"db00945": "Drug"}


class TestEndpointLabels:
    """Edges can reference nodes the node query's limit never reached.

    Both export queries take the same `limit` but run independently, so on a
    graph larger than the limit an edge endpoint is frequently absent from the
    node list. That endpoint still becomes a Datalog constant, and a constant
    with no entry in the label table is exactly the unreadable output the table
    exists to prevent.
    """

    def _store(self) -> StubStore:
        return StubStore(
            nodes=[
                {
                    "id": 1,
                    "labels": ["Drug"],
                    "props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                }
            ],
            edges=[
                {
                    "source": 1,
                    "target": 99,
                    "rel_type": "TARGETS",
                    "props": {},
                    "source_props": {"drugbank_id": "DB00945", "name": "Aspirin"},
                    "target_props": {"uniprot_id": "P23219", "name": "COX-1"},
                }
            ],
        )

    def test_endpoint_outside_the_node_limit_still_gets_a_label(self) -> None:
        """Node 99 is not in the node list, but its fact needs a name."""
        labels = GraphExport(self._store(), limit=1).labels()

        assert labels["db00945"] == "Aspirin"
        assert labels["p23219"] == "COX-1"

    def test_endpoint_label_keys_match_the_fact_constants(self) -> None:
        labels = GraphExport(self._store(), limit=1).labels()

        assert "P23219" not in labels
        assert "p23219" in labels

    def test_endpoint_without_a_name_is_simply_unlabelled(self) -> None:
        store = StubStore(
            nodes=[],
            edges=[
                {
                    "source": 1,
                    "target": 2,
                    "rel_type": "TARGETS",
                    "props": {},
                    "source_props": {"drugbank_id": "DB1"},
                    "target_props": {"uniprot_id": "P1"},
                }
            ],
        )

        assert GraphExport(store, limit=1).labels() == {}

    def test_endpoint_types_are_reported_as_unknown(self) -> None:
        """The edge query does not return labels, so guessing would be a lie."""
        types = GraphExport(self._store(), limit=1).node_types()

        assert types["db00945"] == "Drug"
        assert types["p23219"] == "unknown"

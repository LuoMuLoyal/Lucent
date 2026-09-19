"""The AGE → semantica bridge.

``DatalogReasoner.load_from_graph`` explicitly rejects graph-store handles, so
this adapter is what makes graph-backed inference possible at all. Its output
must match the dict shapes ``add_fact`` accepts, which is what these tests pin.
"""

from __future__ import annotations

from typing import Any

import pytest

from semantica_service.graph.export import GraphExport, _first_label, _turtle_literal


class StubStore:
    """Returns canned AGE results per query kind."""

    def __init__(self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        self._nodes = nodes
        self._edges = edges
        self.queries: list[str] = []

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        self.queries.append(query)
        if "MATCH (n)" in query:
            return {"success": True, "records": self._nodes}
        return {"success": True, "records": self._edges}


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

    class FailingStore:
        def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
            return {"success": False, "error": "boom"}

    with pytest.raises(RuntimeError, match="boom"):
        GraphExport(FailingStore(), limit=10)


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

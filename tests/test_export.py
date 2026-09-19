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


def test_nodes_become_the_reasoner_node_dict_shape() -> None:
    """`add_fact` reads {id, type} for nodes."""
    store = StubStore(nodes=[{"id": 1, "labels": ["Drug"], "props": {"name": "Aspirin"}}], edges=[])
    export = GraphExport(store, limit=10)

    node = next(iter(export.find_nodes()))
    assert node["id"] == "1"
    assert node["type"] == "Drug"
    assert node["properties"] == {"name": "Aspirin"}


def test_edges_become_the_reasoner_edge_dict_shape() -> None:
    """`add_fact` reads {source, target, type} for edges."""
    store = StubStore(
        nodes=[],
        edges=[
            {
                "source": 1,
                "target": 2,
                "rel_type": "INTERACTS_WITH",
                "props": {},
                "source_labels": ["Drug"],
            }
        ],
    )
    export = GraphExport(store, limit=10)

    edge = next(iter(export.find_edges()))
    assert edge["source"] == "1"
    assert edge["target"] == "2"
    assert edge["type"] == "INTERACTS_WITH"


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
                {"id": 2, "labels": ["Protein"], "props": {}},
            ],
            edges=[{"source": 1, "target": 2, "rel_type": "TARGETS", "props": {}}],
        )
        turtle = GraphExport(store, limit=10).to_turtle()

        assert "lucent:node1 a lucent:Drug" in turtle
        assert 'lucent:name "Aspirin"' in turtle
        assert "lucent:node1 lucent:TARGETS lucent:node2" in turtle

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

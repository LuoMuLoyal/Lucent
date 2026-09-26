"""The AGE -> Explorer export bridge, and the two ways it produced a broken picture.

The Explorer loads its graph through ``ContextGraph.load_from_file`` into memory
and has no AGE adapter, so this script is the only path from the real DrugBank
graph to the official UI. Two measured failures shaped it, and both are pinned
here because both render as a *plausible* picture rather than an error:

* **A disjoint selection.** ``GraphExport`` bounds nodes and edges independently.
  With a limit of 400 the node query (ordered by business key) filled entirely
  with drugs while every edge pointed at a protein, so the export was 400 nodes
  and 400 edges sharing zero endpoints. The Explorer draws that as 400 isolated
  dots and reports no error — neither query was truncated, the sets simply never
  met.
* **Type collapse.** ``INTERACTS_WITH`` is 200,182 of 211,630 edges, so ranking
  purely by endpoint degree produced 400 interaction edges across 37 drug nodes
  and no proteins at all. The mechanistic relationships were crowded out.

The selection functions are exercised directly with synthetic exports: the bugs
are in the *choice* of what to keep, not in the AGE read, and a unit test that
needs a live database to catch them would not run in CI.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

# The script lives in scripts/, which is not an importable package.
_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "export_context_graph.py"
_spec = importlib.util.spec_from_file_location("export_context_graph", _SCRIPT)
assert _spec is not None and _spec.loader is not None
export_context_graph = importlib.util.module_from_spec(_spec)
sys.modules["export_context_graph"] = export_context_graph
_spec.loader.exec_module(export_context_graph)

build_document = export_context_graph.build_document
_scope_slug = export_context_graph._scope_slug


class _Range:
    def describe(self) -> dict[str, Any]:
        return {"scope": "test"}


class _FakeExport:
    """A GraphExport stand-in: the selection logic only calls these two."""

    def __init__(self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        self._nodes = nodes
        self._edges = edges
        self.range = _Range()

    def find_nodes(self) -> list[dict[str, Any]]:
        return self._nodes

    def find_edges(self) -> list[dict[str, Any]]:
        return self._edges


def _node(key: str, label: str = "x", node_type: str = "Drug") -> dict[str, Any]:
    return {"id": key, "type": node_type, "properties": {"name": label}}


def _edge(source: str, target: str, rel_type: str = "INTERACTS_WITH") -> dict[str, Any]:
    return {"source": source, "target": target, "type": rel_type, "properties": {}}


class TestDisjointSelection:
    """The regression: a payload with no connected component."""

    def test_edges_without_present_endpoints_are_dropped(self) -> None:
        nodes = [_node("DB001"), _node("DB002")]
        edges = [_edge("DB001", "P999"), _edge("DB001", "DB002")]
        doc = build_document(_FakeExport(nodes, edges), limit=50)
        assert [e["target"] for e in doc["edges"]] == ["DB002"]
        assert doc["_export"]["dangling_edges_dropped"] == 1

    def test_every_rendered_edge_has_both_endpoints(self) -> None:
        # The invariant the Explorer cannot check for us: ContextGraph accepts a
        # dangling endpoint silently and the UI then draws an edge to nowhere.
        nodes = [_node("DB001"), _node("DB002"), _node("P001", node_type="Protein")]
        edges = [
            _edge("DB001", "DB002"),
            _edge("DB002", "P001", "ACTS_ON"),
            _edge("DB001", "P404"),
        ]
        doc = build_document(_FakeExport(nodes, edges), limit=50)
        ids = {n["id"] for n in doc["nodes"]}
        assert all(e["source"] in ids and e["target"] in ids for e in doc["edges"])
        assert "P404" not in ids

    def test_a_fully_disjoint_export_yields_no_edges(self) -> None:
        # This is the shape the caller must refuse to write; the script exits
        # non-zero rather than emitting it.
        nodes = [_node("DB001")]
        edges = [_edge("DB001", "P001")]
        doc = build_document(_FakeExport(nodes, edges), limit=50)
        assert doc["edges"] == []
        assert doc["_export"]["connected_edges"] == 0


class TestTypeBalance:
    """The regression: degree ranking collapsing everything onto one type."""

    def test_a_dominant_type_does_not_crowd_out_the_others(self) -> None:
        nodes = [_node(f"DB{i:03d}") for i in range(30)]
        nodes += [_node(f"P{i:03d}", node_type="Protein") for i in range(5)]
        # 100 interactions among drugs, plus a handful of mechanism edges that
        # touch proteins. Degree ranking alone would take only the former.
        edges = [_edge(f"DB{i:03d}", f"DB{(i + 1) % 30:03d}") for i in range(100)]
        edges += [_edge(f"DB{i:03d}", f"P{i:03d}", "ACTS_ON") for i in range(5)]

        doc = build_document(_FakeExport(nodes, edges), limit=20)
        rendered = {e["type"] for e in doc["edges"]}
        assert "ACTS_ON" in rendered, "mechanism edges must survive a dominant interaction type"
        assert "INTERACTS_WITH" in rendered, "the dominant type must still be represented"

    def test_protein_nodes_appear_when_mechanism_edges_are_kept(self) -> None:
        nodes = [_node(f"DB{i:03d}") for i in range(30)]
        nodes += [_node(f"P{i:03d}", node_type="Protein") for i in range(5)]
        edges = [_edge(f"DB{i:03d}", f"DB{(i + 1) % 30:03d}") for i in range(100)]
        edges += [_edge(f"DB{i:03d}", f"P{i:03d}", "ACTS_ON") for i in range(5)]

        doc = build_document(_FakeExport(nodes, edges), limit=20)
        assert "Protein" in doc["_export"]["rendered_node_types"]

    def test_the_edge_limit_is_respected(self) -> None:
        nodes = [_node(f"DB{i:03d}") for i in range(20)]
        edges = [_edge(f"DB{i:03d}", f"DB{(i + 1) % 20:03d}") for i in range(200)]
        doc = build_document(_FakeExport(nodes, edges), limit=15)
        assert len(doc["edges"]) <= 15

    def test_duplicate_edges_are_not_double_counted(self) -> None:
        # AGE stores each interaction once per direction; a payload repeating the
        # same triple would inflate the degree ranking and the edge count.
        nodes = [_node("DB001"), _node("DB002")]
        edges = [_edge("DB001", "DB002"), _edge("DB001", "DB002")]
        doc = build_document(_FakeExport(nodes, edges), limit=50)
        assert len(doc["edges"]) == 1


class TestDeterminism:
    """Two runs over one graph must agree, or a diff is meaningless."""

    def test_output_is_stable_across_input_order(self) -> None:
        nodes = [_node(f"DB{i:03d}") for i in range(12)]
        edges = [_edge(f"DB{i:03d}", f"DB{(i + 1) % 12:03d}") for i in range(11)]
        first = build_document(_FakeExport(nodes, edges), limit=6)
        second = build_document(_FakeExport(list(reversed(nodes)), list(reversed(edges))), limit=6)
        assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


class TestScopeSlug:
    def test_slug_is_filesystem_safe_and_stable(self) -> None:
        assert _scope_slug(["Warfarin", "Clopidogrel"], []) == "Warfarin-Clopidogrel"

    def test_slug_scrubs_path_characters(self) -> None:
        slug = _scope_slug(["../etc/passwd"], [])
        assert "/" not in slug and ".." not in slug

    def test_empty_scope_is_named_all(self) -> None:
        assert _scope_slug([], []) == "all"


class TestScopeRefusal:
    """An unnamed scope is the whole graph, which must never be exported."""

    def test_no_scope_exits_nonzero(self, capsys: pytest.CaptureFixture[str]) -> None:
        code = export_context_graph.main([])
        assert code == 2
        assert "Refusing to export the whole graph" in capsys.readouterr().err

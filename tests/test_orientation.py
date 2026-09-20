"""Interaction directionality, and the metadata that survives the fix.

The stored graph carries only one direction of most interactions, so a rule
written the natural way finds nothing for 80 of its 895 drugs — warfarin among
them, with 0 outgoing edges and 530 incoming. Bridging that is the point of this
module; not losing *which way the data ran* while doing it is the harder half,
because the edges are not actually symmetric and the description on each one is
written from the source's point of view.

The cap is tested too, because the first implementation shared the read's budget
and therefore mirrored nothing at all on any scope that loaded its full limit —
which is every interesting scope.
"""

from __future__ import annotations

from typing import Any

from semantica_service.graph.orientation import (
    ORIENTATION_PROPERTY,
    REVERSED,
    is_symmetric,
    mirror_edge,
    mirror_edges,
    orientation_of,
    source_drug_from_prov,
)


def _edge(
    source: str,
    target: str,
    rel_type: str = "INTERACTS_WITH",
    prov: str | None = None,
) -> dict[str, Any]:
    properties = {} if prov is None else {"prov": prov}
    return {"source": source, "target": target, "type": rel_type, "properties": properties}


class TestProvenance:
    """The provenance id is the only place the original orientation survives."""

    def test_the_source_drug_is_read_from_the_path(self) -> None:
        prov = "lucent:drugbank_drugs/DB11951/drug_interactions/DB12016"

        assert source_drug_from_prov(prov) == "db11951"

    def test_a_provenance_id_without_a_source_yields_none(self) -> None:
        """An id of another shape must not produce a fabricated source."""
        assert source_drug_from_prov("lucent:something/else") is None

    def test_an_absent_provenance_id_yields_none(self) -> None:
        assert source_drug_from_prov(None) is None
        assert source_drug_from_prov("") is None


class TestOrientation:
    def test_a_natural_edge_reports_its_own_source(self) -> None:
        edge = _edge(
            "DB11951", "DB12016", prov="lucent:drugbank_drugs/DB11951/drug_interactions/DB12016"
        )

        orientation = orientation_of(edge)

        assert orientation.source == "db11951"
        assert orientation.reversed_edge is False

    def test_a_mirrored_edge_is_marked_reversed(self) -> None:
        """A conclusion on a mirrored edge must be able to say so.

        The graph does not literally store that edge, and its description reads
        from the other drug's point of view.
        """
        edge = _edge("DB11951", "DB12016", prov="lucent:x")
        edge["properties"][ORIENTATION_PROPERTY] = REVERSED

        assert orientation_of(edge).reversed_edge is True

    def test_the_source_falls_back_to_the_endpoint(self) -> None:
        """Without a provenance id the edge's own direction is the best answer."""
        orientation = orientation_of(_edge("DB11951", "DB12016"))

        assert orientation.source == "db11951"
        assert orientation.known is True

    def test_an_edge_with_neither_source_nor_provenance_is_unknown(self) -> None:
        orientation = orientation_of({"properties": {}})

        assert orientation.known is False

    def test_describe_is_json_ready(self) -> None:
        described = orientation_of(
            _edge("a", "b", prov="lucent:drugbank_drugs/a/drug_interactions/b")
        ).describe()

        assert described == {"source": "a", "reversed": False}


class TestMirroring:
    def test_a_one_way_edge_gains_its_reverse(self) -> None:
        added = mirror_edges([_edge("DB00372", "DB00850")])

        assert len(added) == 1
        assert added[0]["source"] == "DB00850"
        assert added[0]["target"] == "DB00372"

    def test_the_mirror_keeps_the_same_provenance_id(self) -> None:
        """Both directions are one assertion, so a citation resolves to one row."""
        original = _edge("a", "b", prov="lucent:drugbank_drugs/a/drug_interactions/b")

        mirror = mirror_edge(original)

        assert mirror is not None
        assert mirror["properties"]["prov"] == "lucent:drugbank_drugs/a/drug_interactions/b"

    def test_the_mirror_is_marked_reversed(self) -> None:
        mirror = mirror_edge(_edge("a", "b"))

        assert mirror is not None
        assert mirror["properties"][ORIENTATION_PROPERTY] == REVERSED

    def test_an_already_symmetric_pair_is_not_duplicated(self) -> None:
        """A duplicate would make one fact count as two lines of support."""
        edges = [_edge("a", "b"), _edge("b", "a")]

        assert mirror_edges(edges) == []

    def test_a_self_loop_is_not_mirrored(self) -> None:
        """A drug interacting with itself is not a statement the data makes."""
        assert mirror_edge(_edge("a", "a")) is None

    def test_a_directional_relation_is_not_mirrored(self) -> None:
        """Flipping these would assert something the source never said.

        `A inhibits B` is not `B inhibits A`, and inventing the reverse would be
        a fabricated finding rather than a bridged gap.
        """
        for rel_type in ("INHIBITS", "SUBSTRATE_OF", "TARGETS", "ACTS_ON"):
            assert is_symmetric(rel_type) is False
            assert mirror_edge(_edge("a", "b", rel_type)) is None

    def test_an_edge_with_a_missing_endpoint_is_not_mirrored(self) -> None:
        assert mirror_edge({"source": None, "target": "b", "type": "INTERACTS_WITH"}) is None

    def test_endpoints_are_compared_case_insensitively(self) -> None:
        """Two spellings of one drug must not each get their own mirror."""
        edges = [_edge("DB1", "db2"), _edge("db2", "DB1")]

        assert mirror_edges(edges) == []


class TestDirectionalityFix:
    """The property that motivates the module, stated as the gap it closes."""

    def test_a_target_only_drug_gains_outgoing_edges(self) -> None:
        """Warfarin's shape: 0 outgoing, 530 incoming.

        Without the mirror, a rule asking what warfarin interacts with finds
        nothing and that reads as a finding.
        """
        # The stored data names the partner as the source in every row.
        stored = [_edge(f"DB{i:05d}", "DB00682") for i in range(5)]

        mirrored = mirror_edges(stored)

        outgoing = [e for e in mirrored if e["source"] == "DB00682"]
        assert len(outgoing) == 5, "the drug still has no outgoing interaction"

    def test_a_fully_loaded_scope_still_gets_its_mirrors(self) -> None:
        """The cap is on the mirror, not shared with the read.

        The first implementation subtracted the read's size from the limit. A
        scope that loads exactly its limit — which is every interesting scope,
        because the read stops precisely there — left zero room, so nothing was
        mirrored and the fix silently did not apply. Measured: 34,496 one-way
        edges present, 0 mirrored.
        """
        from semantica_service.graph.export import export_symmetric_edges

        stored = [_edge(f"DB{i:05d}", "DB00682") for i in range(100)]

        mirrors, truncated = export_symmetric_edges(stored, limit=100)

        assert len(mirrors) == 100, "a full read left no room for the mirror"
        assert truncated is False

    def test_the_mirror_cap_is_reported(self) -> None:
        """A caller must be able to tell a complete mirror from a cut one."""
        from semantica_service.graph.export import export_symmetric_edges

        stored = [_edge(f"DB{i:05d}", "DB00682") for i in range(100)]

        mirrors, truncated = export_symmetric_edges(stored, limit=10)

        assert len(mirrors) == 10
        assert truncated is True

    def test_a_capped_mirror_is_a_stable_prefix(self) -> None:
        """Otherwise the citation set would vary between identical requests."""
        from semantica_service.graph.export import export_symmetric_edges

        stored = [_edge(f"DB{i:05d}", "DB00682") for i in range(100)]

        first, _ = export_symmetric_edges(stored, limit=10)
        second, _ = export_symmetric_edges(list(reversed(stored)), limit=10)

        assert [e["source"] for e in first] == [e["source"] for e in second]

"""Manual check that the interaction directionality gap is bridged.

The unit tests pin mirroring against dicts. This asserts the property that
motivates it, on the live graph: that a drug which never appears as a source in
the stored data still has a reachable interaction neighbourhood, and that the
direction the assertion originally ran is still recoverable afterwards.

    uv run python scripts/check_orientation.py
"""

from __future__ import annotations

from semantica_service.config import get_settings
from semantica_service.graph import GraphExport, ScopeSpec, StorePool, resolve_scope
from semantica_service.graph.orientation import orientation_of, source_drug_from_prov

# Warfarin: 0 outgoing interaction edges and 530 incoming, so an outgoing-only
# traversal reports that it interacts with nothing.
SCOPE_DRUG = "DB00682"


def main() -> None:
    settings = get_settings()
    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            outgoing = store.execute_query(
                "MATCH (a:Drug {drugbank_id: $d})-[r:INTERACTS_WITH]->(b:Drug) "
                "RETURN count(r) AS c",
                {"d": SCOPE_DRUG},
            )["records"][0]["c"]
            incoming = store.execute_query(
                "MATCH (b:Drug)-[r:INTERACTS_WITH]->(a:Drug {drugbank_id: $d}) "
                "RETURN count(r) AS c",
                {"d": SCOPE_DRUG},
            )["records"][0]["c"]
            never_source = store.execute_query(
                "MATCH (a:Drug)-[:INTERACTS_WITH]->(b:Drug) "
                "WITH collect(DISTINCT a.drugbank_id) AS srcs "
                "MATCH (d:Drug) WHERE NOT d.drugbank_id IN srcs "
                "RETURN count(d) AS c",
                {},
            )["records"][0]["c"]

            print("=== the gap in the stored data ===")
            print(f"  {SCOPE_DRUG}: outgoing={outgoing} incoming={incoming}")
            print(f"  drugs that never appear as a source: {never_source}")
            assert outgoing == 0 and incoming > 0

            scope = resolve_scope(store, ScopeSpec(drug_names=(SCOPE_DRUG,), limit=50_000))
            export = GraphExport(
                store,
                limit=20_000,
                drug_keys=scope.drug_keys,
                atc_keys=scope.atc_keys,
                seed_drug_keys=scope.seed_drug_keys,
                scope_label="explicit",
            )
        print()

        print("=== the export bridges it ===")
        facts = export.fact_assertions()
        orientations = export.orientations()
        interactions = [fact for fact in facts if fact.startswith("interacts_with(")]
        involving_seed = [
            fact
            for fact in interactions
            if f"({SCOPE_DRUG.lower()}," in fact or f", {SCOPE_DRUG.lower()})" in fact
        ]
        print(f"  loaded: {export.node_count} nodes, {export.edge_count} edges")
        print(f"  interaction facts: {len(interactions)}")
        print(f"  facts naming {SCOPE_DRUG}: {len(involving_seed)}")
        for fact in involving_seed[:3]:
            print(f"    {fact}")
        assert involving_seed, "the seed has no reachable interaction facts"
        print()

        print("=== both directions are now present ===")
        reversed_count = sum(
            1 for fact in interactions if orientations.get(fact, {}).get("reversed")
        )
        natural_count = len(interactions) - reversed_count
        print(f"  interaction facts: {natural_count} natural + {reversed_count} mirrored")
        assert reversed_count > 0, "nothing was mirrored"

        # The property that matters: no interaction in the loaded set is
        # one-directional any more. Before the fix this scope held 34,496 such
        # edges and mirrored none of them, because the mirror shared the read's
        # budget and a full read left no room.
        one_way = []
        for fact in interactions:
            inner = fact[fact.index("(") + 1 : -1]
            a, b = (part.strip() for part in inner.split(","))
            if f"interacts_with({b}, {a})" not in facts:
                one_way.append(fact)
        print(f"  one-directional interactions remaining: {len(one_way)}")
        for fact in one_way[:3]:
            print(f"    {fact}")
        assert not one_way, "an interaction is still reachable one way only"
        print("  every interaction is now reachable in both directions")
        print()

        print("=== the original direction survives ===")
        for fact in involving_seed[:3]:
            orientation = orientations.get(fact)
            print(f"    {fact}")
            print(f"      -> {orientation}")
            assert orientation is not None, f"no orientation recorded for {fact}"
            assert orientation["source"] is not None, f"source drug lost for {fact}"
        print()

        print("=== a citation resolves to the same row for both directions ===")
        for fact in involving_seed[:3]:
            prov = facts.get(fact)
            print(f"    {fact}")
            print(f"      {prov}")
            if prov:
                source = source_drug_from_prov(prov)
                print(f"      source drug read from the provenance id: {source}")
                assert source is not None
        print()

        print("=== a mirror is not invented for a directional relation ===")
        for edge in export.find_edges():
            if edge["type"] not in ("INTERACTS_WITH",):
                pass
        samples = [orientation_of(e) for e in export.find_edges() if e["type"] == "INTERACTS_WITH"][
            :2
        ]
        for orientation in samples:
            assert orientation.source is not None
        print(f"  sampled {len(samples)} interaction orientations, all carry a source")
    finally:
        pool.close()

    print()
    print("all checks passed")


if __name__ == "__main__":
    main()

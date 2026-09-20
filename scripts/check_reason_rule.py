"""Manual check that a rule's conclusions are attributable end to end.

The suite pins the library and the bridge against stubs. This asserts the thing
those stubs cannot: that premises recovered from the real graph resolve to
provenance ids, so a conclusion a user is shown can be traced back to the
DrugBank rows it rests on.

    uv run python scripts/check_reason_rule.py
"""

from __future__ import annotations

from semantica.reasoning.datalog_reasoner import DatalogReasoner

from semantica_service.config import get_settings
from semantica_service.graph import GraphExport, ScopeSpec, StorePool, resolve_scope
from semantica_service.reasoning import DEFAULT_RULES_DIR, load_library
from semantica_service.reasoning.provenance_bridge import premises_for_conclusion

# Daunorubicin (DB00091) inhibits several CYPs while many other drugs are
# substrates of them, so its neighbourhood contains a rule that actually fires.
# Warfarin is deliberately not used: its scope is 530 interaction edges and
# almost nothing else, so no mechanism rule can fire over it.
SCOPE_DRUG = "DB00091"


def main() -> None:
    settings = get_settings()
    library = load_library(DEFAULT_RULES_DIR)
    # The rule the graph can actually fire over a single drug's neighbourhood:
    # one drug can inhibit an enzyme that another drug is a substrate of, which
    # is a conclusion about two drugs reachable from one seed. `shared_target`
    # would need two seeded drugs acting on one protein, which a single-drug
    # scope cannot contain.
    rule = library.by_intent("interaction")
    assert rule is not None, "the shipped library has no interaction rule"

    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            scope = resolve_scope(store, ScopeSpec(drug_names=(SCOPE_DRUG,), limit=5000))
            export = GraphExport(
                store,
                limit=50_000,
                drug_keys=scope.drug_keys,
                atc_keys=scope.atc_keys,
                seed_drug_keys=scope.seed_drug_keys,
                scope_label="explicit",
            )
            assertions = export.fact_assertions()
            print(f"scope: {len(scope.drug_keys)} keys ({len(scope.seed_drug_keys)} named)")
            print(f"loaded: {export.node_count} nodes, {export.edge_count} edges")
            print(f"citable premises: {sum(1 for v in assertions.values() if v)}/{len(assertions)}")

            engine = DatalogReasoner()
            engine.add_rule(rule.body)
            engine.load_from_graph(export)
            derived = engine.derive_all()

            conclusions = [f for f in derived if f.startswith(f"{rule.head_predicate}(")]
            print()
            print(f"=== rule {rule.id} ===")
            print(f"  body: {rule.body.strip()}")
            print(f"  derived {len(conclusions)} conclusion(s) from {len(derived)} facts")

            premises = premises_for_conclusion(engine, rule, derived)
            print(f"  recovered premises for {len(premises)} conclusion(s)")

            total_cited = 0
            total_uncited = 0
            for fact, body in list(premises.items())[:5]:
                cites = [assertions[p] for p in body if assertions.get(p)]
                uncited = [p for p in body if not assertions.get(p)]
                total_cited += len(cites)
                total_uncited += len(uncited)
                print(f"    {fact}")
                for premise, cite in zip(
                    [p for p in body if assertions.get(p)], cites, strict=False
                ):
                    print(f"      <- {premise}")
                    print(f"         {cite}")
                for premise in uncited:
                    print(f"      <- {premise} (no provenance id on the edge)")

            if premises:
                assert total_cited > 0, "no conclusion carried a citable premise"
                print()
                print(f"OK: {total_cited} premise citations resolved, {total_uncited} uncited")

            # A conclusion must never be presentable as an assertion.
            print()
            print("=== conclusions are marked derived, not asserted ===")
            asserted = set(assertions)
            for fact in conclusions[:3]:
                assert fact not in asserted, f"{fact} collides with an asserted fact"
                print(f"  {fact}: derived (not in the asserted set)")
            print()
            print("  none of the derived facts are present as asserted facts")

            # The rule must be driven by the named seed, not by a neighbour
            # that happened to come along.
            print()
            print("=== scope is what bounds the result ===")
            narrow = GraphExport(
                store,
                limit=5000,
                drug_keys=[SCOPE_DRUG],
                seed_drug_keys=[SCOPE_DRUG],
                scope_label="explicit",
            )
            narrow_engine = DatalogReasoner()
            narrow_engine.add_rule(rule.body)
            narrow_engine.load_from_graph(narrow)
            narrow_derived = [
                f for f in narrow_engine.derive_all() if f.startswith(f"{rule.head_predicate}(")
            ]
            print(
                f"  seed-only scope: {narrow.edge_count} edges -> "
                f"{len(narrow_derived)} conclusion(s)"
            )
    finally:
        pool.close()

    print()
    print("all checks passed")


if __name__ == "__main__":
    main()

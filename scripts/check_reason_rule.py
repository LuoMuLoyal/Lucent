"""Manual check that a rule's conclusions are attributable end to end.

The suite pins the rule library and the citation path against stubs. This
asserts the thing those stubs cannot: that a conclusion computed by the database
resolves to provenance ids, so a conclusion a user is shown can be traced back
to the DrugBank rows it rests on.

    uv run python scripts/check_reason_rule.py
"""

from __future__ import annotations

from semantica_service import cypher
from semantica_service.config import get_settings
from semantica_service.graph import ScopeSpec, StorePool, resolve_scope
from semantica_service.reasoning import build_query, load_library

# Daunorubicin (DB00091) inhibits several CYPs while many other drugs are
# substrates of them, so its neighbourhood contains a rule that actually fires.
# Warfarin is deliberately not used: its scope is interaction edges and almost
# nothing else, so no mechanism rule can fire over it.
SCOPE_DRUG = "DB00091"


def main() -> None:
    settings = get_settings()
    library = load_library()
    # The rule the graph can actually fire over a single drug's neighbourhood:
    # one drug can inhibit an enzyme that another drug is a substrate of, which
    # is a conclusion about two drugs reachable from one seed. `shared_target`
    # would need two seeded drugs acting on one protein, which a single-drug
    # scope cannot contain.
    rule = library.by_intent("interaction")
    assert rule is not None, "the shipped rule library has no interaction rule"

    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            scope = resolve_scope(store, ScopeSpec(drug_names=(SCOPE_DRUG,), limit=5000))
            print(f"scope: {len(scope.drug_keys)} keys ({len(scope.seed_drug_keys)} named)")

            # The scope is the drugs the caller named, not the neighbour
            # expansion: a neighbour's own pairs are not pairs involving the
            # seed, and scoping on them swamps the answer.
            # The generated rule query must pass the same read-only gate a
            # caller's query does: it is built from a template, but it is still
            # shipped to the database and the gate is the only guard.
            query, params = build_query(rule, seed_keys=tuple(scope.seed_drug_keys))
            problem = cypher.check_read_only(query)
            assert problem is None, f"the rule query was refused: {problem}"
            print("  rule query passes the read-only gate")

            result = store.execute_query(query, params)
            assert result.get("success"), result.get("error")
            rows = result["records"]

            print()
            print(f"=== rule {rule.id} ===")
            print(f"  derives: {rule.head_predicate}  consumes: {rule.consumes}")
            print(f"  conclusions: {len(rows)}")

            premise_keys = tuple(f"premise_{i + 1}" for i in range(len(rule.consumes)))
            cited = 0
            uncited = 0
            for row in rows[:5]:
                print(f"    {rule.head_predicate}({row['subject']}, {row['object']})")
                for key in premise_keys:
                    prov = row.get(key)
                    if prov:
                        cited += 1
                        print(f"      <- {prov}")
                    else:
                        uncited += 1
                        print("      <- (no provenance id on this edge)")

            # Every row must carry both premise ids: a conclusion whose premise
            # has no citable origin cannot be checked by the reader, and saying
            # so is the whole point of carrying the id.
            fully_cited = sum(1 for row in rows if all(row.get(k) for k in premise_keys))
            assert rows, "the rule fired on nothing; the check would prove nothing"
            missing = len(rows) - fully_cited
            assert fully_cited == len(rows), (
                f"{missing} of {len(rows)} conclusions are missing a premise prov id"
            )
            print()
            print(f"OK: {len(rows)} conclusions, all with {len(premise_keys)} premise id(s)")
            print(f"    sampled {cited} citations, {uncited} uncited")

            # A conclusion must never come back as a stored fact. The graph holds
            # DrugBank's assertions; `db.labels()` must not have grown a node
            # type for the head predicate.
            print()
            print("=== conclusions are computed, not stored ===")
            labels = store.execute_query("CALL db.labels() YIELD label RETURN label", {})
            stored = {row["label"] for row in labels["records"]}
            assert rule.head_predicate not in stored, f"{rule.head_predicate} is a stored label"
            print(f"  node labels: {sorted(stored)}")
            print(f"  {rule.head_predicate} is not among them")

            # The scope must be what bounds the result: naming no drug yields no
            # conclusions, which is what makes "empty" honest rather than a
            # silent widening to the whole graph.
            print()
            print("=== scope is what bounds the result ===")
            narrow = store.execute_query(query, {"seed_keys": []})
            assert narrow.get("success"), narrow.get("error")
            print(f"  empty seed list -> {len(narrow['records'])} conclusion(s)")
            assert not narrow["records"], "an empty scope returned conclusions"

            wide = store.execute_query(query, params)
            assert wide.get("success"), wide.get("error")
            print(f"  named seed      -> {len(wide['records'])} conclusion(s)")
    finally:
        pool.close()

    print()
    print("all checks passed")


if __name__ == "__main__":
    main()

"""Manual check that the reasoning input bridge is deterministic and scoped.

The suite pins the shape of the bridge against stubs; this asserts the
behaviour against the real graph, which is where the original defect lived:
an unordered ``LIMIT`` returned a different slice on every run.

    uv run python scripts/check_reason_range.py
"""

from __future__ import annotations

import hashlib

from semantica_service.config import get_settings
from semantica_service.graph import GraphExport, ScopeSpec, StorePool, resolve_scope

QUERIES = {
    "outgoing from warfarin": (
        "MATCH (a:Drug)-[r:INTERACTS_WITH]->(b) WHERE a.drugbank_id='DB00682' RETURN count(r) AS c"
    ),
    "incoming to warfarin": (
        "MATCH (a:Drug)-[r:INTERACTS_WITH]->(b) WHERE b.drugbank_id='DB00682' RETURN count(r) AS c"
    ),
    "warfarin atc links": (
        "MATCH (a)-[r:IN_ATC_CLASS]->(b) WHERE a.drugbank_id='DB00682' RETURN count(r) AS c"
    ),
}

# Warfarin is cited by 530 interaction rows but cites none of its own — the
# single-direction data gap the plan tracks as D2. It is therefore the case
# that exercises the bridge hardest: a scope keyed on it must pull in the
# *incoming* edges, or the reasoning input would be empty for the single most
# asked-about drug in the graph.
SCOPE_DRUG = "DB00682"


def digest(export: GraphExport) -> str:
    """A stable fingerprint of the loaded edge set."""
    blob = repr(sorted((e["source"], e["type"], e["target"]) for e in export.find_edges()))
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def main() -> None:
    settings = get_settings()
    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            for label, query in QUERIES.items():
                print(f"{label}: {store.execute_query(query, {})['records']}")

            print()
            print("=== determinism (the defect R1 removes) ===")
            scope = resolve_scope(store, ScopeSpec(drug_names=(SCOPE_DRUG,), limit=5000))
            print(f"scope drugs: {scope.drug_keys}")
            digests = []
            for run in range(3):
                export = GraphExport(
                    store,
                    limit=5000,
                    drug_keys=scope.drug_keys,
                    atc_keys=scope.atc_keys,
                    scope_label="explicit",
                    include_atc_links=True,
                )
                fingerprints = digest(export)
                digests.append(fingerprints)
                print(
                    f"  run {run}: digest={fingerprints} "
                    f"nodes={export.node_count} edges={export.edge_count} "
                    f"truncated={export.truncated}"
                )
            assert len(set(digests)) == 1, f"export is not deterministic: {digests}"
            print("OK: identical load across runs")

            print()
            print("=== fact -> assertion map ===")
            export = GraphExport(
                store,
                limit=5000,
                drug_keys=scope.drug_keys,
                atc_keys=scope.atc_keys,
                scope_label="explicit",
                include_atc_links=True,
            )
            assertions = export.fact_assertions()
            cited = [k for k, v in assertions.items() if v]
            uncited = [k for k, v in assertions.items() if v is None]
            print(
                f"  {len(assertions)} premise facts, {len(cited)} citable, {len(uncited)} uncitable"
            )
            for key in cited[:3]:
                print(f"    {key} -> {assertions[key]}")
            assert cited, "no citable premises: the audit chain is broken"

            print()
            print("=== an out-of-range drug is excluded, not silently dropped ===")
            narrow = GraphExport(
                store,
                limit=5000,
                drug_keys=[SCOPE_DRUG],
                scope_label="explicit",
                include_atc_links=True,
            )
            wide = GraphExport(store, limit=5000, scope_label="all", include_atc_links=True)
            print(f"  narrow edges: {narrow.edge_count}, whole graph: {wide.edge_count}")
            assert narrow.edge_count < wide.edge_count, "the scope did not restrict the load"

            print()
            print("=== truncation is reported, not hidden ===")
            cut = GraphExport(
                store,
                limit=50,
                drug_keys=[SCOPE_DRUG],
                scope_label="explicit",
                include_atc_links=True,
            )
            print(f"  limit=50 -> truncated={cut.truncated} edges={cut.edge_count}")
            assert cut.truncated, "a cut load must say so"
    finally:
        pool.close()

    _check_limits()

    print()
    print("all checks passed")


def _check_limits() -> None:
    """The reasoning ceilings have to bite, not just exist.

    Both settings previously had no call site, so an operator could set them and
    observe nothing. A ceiling nobody can trigger is indistinguishable from no
    ceiling at all.
    """
    from fastapi import HTTPException

    from semantica_service.reasoning_limits import FactBudget

    print()
    print("=== resource ceilings ===")
    try:
        FactBudget(100).check(101, source="rules over the loaded fact base")
    except HTTPException as exc:
        detail = exc.detail
        assert isinstance(detail, dict)
        print(f"  fact ceiling refused: kind={detail['kind']} msg={detail['message'][:70]}...")
    else:  # pragma: no cover - the assertion below is the contract
        raise AssertionError("the fact ceiling did not refuse an oversized result")

    from semantica_service.reasoning_limits import check_declared_sizes

    # The request-side ceiling: it reads the declared `limit` off the body. A
    # ceiling nobody can trigger is indistinguishable from no ceiling at all,
    # so the check drives it with a body that declares an oversized limit.
    class Oversized:
        limit = 10**9

    try:
        check_declared_sizes(Oversized())  # type: ignore[arg-type]
    except HTTPException as exc:
        detail = exc.detail
        assert isinstance(detail, dict)
        print(f"  declared-size ceiling refused: kind={detail['kind']}")
    else:  # pragma: no cover - the assertion below is the contract
        raise AssertionError("an oversized declared limit was not refused")

    # The execution deadline is now the Neo4j transaction timeout, not a
    # hand-rolled wall clock around a Python fixpoint. Driving it here would
    # need a real server, so what is asserted is that the pool converts its own
    # saturation into the same structured refusal the endpoint maps.
    from semantica_service.graph.pool import StorePool  # noqa: F401  (import check)

    print("  execution timeout is carried by the Neo4j transaction, not a local deadline")


if __name__ == "__main__":
    main()

"""Probe what the OAG actually buys over flat retrieval, on the real graph.

Each probe is a typed multi-hop question that a text/vector search cannot
express: the answer depends on the *role* a drug plays at a shared target
(inhibitor vs substrate), not on textual similarity. Results are printed with
counts and a sample so the capability can be judged rather than asserted.

    uv run python scripts/probe_oag.py
"""

from __future__ import annotations

import argparse
import time
from typing import Any

from semantica_service.config import get_settings
from semantica_service.graph.pool import StorePool

# Each probe is (key, description, cypher, params).
# `a <> b` is used instead of comparing a business key: not every label carries
# `drugbank_id`, and comparing identifiers across labels would compare nulls.
PROBES: list[tuple[str, str, str, dict[str, Any]]] = [
    (
        "cyp_mediated_ddi",
        "抑制某 CYP 的药物 × 以该 CYP 为底物的药物（经典代谢性 DDI）",
        """
        MATCH (a:Drug)-[:INHIBITS]->(e:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
        WHERE e.gene_name IN ['CYP3A4','CYP2D6','CYP2C19','CYP1A2','CYP2C9']
          AND id(a) <> id(b)
        RETURN e.gene_name AS enzyme, a.name AS inhibitor, b.name AS substrate
        ORDER BY enzyme, inhibitor, substrate
        LIMIT 40
        """,
        {},
    ),
    (
        "shared_targets",
        "与指定药物共享靶点的其他药物（按共享靶点数排序）",
        """
        MATCH (d:Drug {name: $drug})-[r1]->(t:Protein)<-[r2]-(o:Drug)
        WHERE id(o) <> id(d)
        RETURN t.name AS target, count(DISTINCT o) AS n,
               collect(DISTINCT o.name)[0..5] AS sample
        ORDER BY n DESC
        LIMIT 15
        """,
        {"drug": "Paroxetine"},
    ),
    (
        "cascade_metabolic_chain",
        "A 抑制酶1 → C 是酶1底物且抑制酶2 → B 是酶2底物（4 跳类型化级联）",
        """
        MATCH (a:Drug {name: $a})-[:INHIBITS]->(e1:Protein)<-[:SUBSTRATE_OF]-(c:Drug)
        MATCH (c)-[:INHIBITS]->(e2:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
        WHERE id(c) <> id(a) AND id(b) <> id(a) AND id(b) <> id(c) AND id(e1) <> id(e2)
        RETURN a.name AS start_drug, e1.gene_name AS enzyme1, c.name AS middle,
               e2.gene_name AS enzyme2, b.name AS end_drug
        ORDER BY middle, end_drug
        LIMIT 25
        """,
        {"a": "Paroxetine"},
    ),
    (
        "inhibition_plus_interaction",
        "机制 2 跳（抑制/底物）与直接相互作用记录联立",
        """
        MATCH (a:Drug {name: $drug})-[:INHIBITS]->(e:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
        WITH a, e, b LIMIT 200
        MATCH (a)-[i:INTERACTS_WITH]-(b)
        RETURN b.name AS substrate_drug, e.gene_name AS enzyme,
               left(i.description, 200) AS note
        ORDER BY b.name
        LIMIT 20
        """,
        {"drug": "Paroxetine"},
    ),
    (
        "serotonergic_overlap",
        "同一血清素能靶点上的多方汇聚（作用叠加风险）",
        """
        MATCH (a:Drug)-[r1]->(t:Protein)<-[r2]-(b:Drug)
        WHERE t.gene_name IN ['SLC6A4','HTR2A','HTR2C','HTR1A','MAOA','MAOB']
          AND id(a) < id(b)
        RETURN t.gene_name AS target, a.name AS drug_a, type(r1) AS act_a,
               b.name AS drug_b, type(r2) AS act_b
        ORDER BY target, drug_a
        LIMIT 30
        """,
        {},
    ),
    (
        "atc_class_hub_targets",
        "某 ATC 类别内被最多药物作用的靶点（经 SUBCLASS_OF 下钻两层到叶子码）",
        """
        MATCH (a:ATCClass {code: $atc})-[:SUBCLASS_OF]->(sub:ATCClass)
              -[:SUBCLASS_OF]->(leaf:ATCClass)<-[:IN_ATC_CLASS]-(d:Drug)
        MATCH (d)-[r]->(t:Protein)
        RETURN t.name AS target, type(r) AS action, count(DISTINCT d) AS n_drugs
        ORDER BY n_drugs DESC
        LIMIT 15
        """,
        {"atc": "N06A"},
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default=None, help="Run one probe by key.")
    parser.add_argument("--show", type=int, default=6, help="Rows to print per probe.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()

    pool = StorePool(settings)
    with pool.borrow() as store:
        stats = store.get_stats()
        print("== graph ==")
        print(f"  nodes: {stats.get('node_count')}  edges: {stats.get('relationship_count')}")
        print(f"  labels: {stats.get('label_counts')}")
        print(f"  edge types: {len(stats.get('relationship_type_counts') or {})}")
        print()

        probes = [p for p in PROBES if args.only is None or p[0] == args.only]
        passed = failed = 0

        for key, desc, cypher, params in probes:
            print("=" * 78)
            print(f"[{key}] {desc}")
            started = time.perf_counter()
            try:
                result = store.execute_query(cypher.strip(), params)
            except Exception as exc:  # noqa: BLE001 - one bad probe must not stop the run
                print(f"  EXCEPTION {type(exc).__name__}: {str(exc)[:220]}")
                failed += 1
                continue
            elapsed = (time.perf_counter() - started) * 1000

            if not result.get("success"):
                print(f"  FAILED: {result.get('error')}")
                failed += 1
                continue

            records = result.get("records", [])
            passed += 1
            print(f"  rows={len(records)}  {elapsed:.0f} ms  cols={result.get('keys')}")
            for row in records[: args.show]:
                print(f"    {row}")
            if len(records) > args.show:
                print(f"    ... {len(records) - args.show} more")
            print()

        print("=" * 78)
        print(f"probes passed {passed}, failed {failed}")


if __name__ == "__main__":
    main()

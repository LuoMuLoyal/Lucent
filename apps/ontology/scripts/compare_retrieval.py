"""Compare OAG typed traversal against the flat retrieval Lucent can do today.

Lucent's DrugBank retrieval is `search_drugbank` (vector similarity
over passage chunks, scoped to one resolved drug) plus `get_drugbank_detail`
(one row). Its embedding table does not exist in this dev database and
`drugbank_passage_chunks` is empty, so the vector path cannot be run verbatim.
The honest substitute is the strongest flat baseline that the columns actually
support: full-text/trigram ranking over the same drug text the vector path
would embed.

For each question this script runs both retrievals and reports what each one
can and cannot answer. The point is not that the graph wins on speed — it is
that some questions have no flat equivalent at all.

    uv run python scripts/compare_retrieval.py
"""

from __future__ import annotations

import json
import time
from typing import Any

import psycopg2
import psycopg2.extras

from semantica_service.config import get_settings
from semantica_service.graph.adapter import Neo4jGraphStore
from semantica_service.graph.pool import StorePool

SOURCE_DSN = "host=127.0.0.1 port=5432 dbname=lucent user=postgres password=postgres"


def pg() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(SOURCE_DSN)
    conn.set_session(readonly=True)
    return conn


def flat_search(cur: Any, terms: str, limit: int = 10) -> list[dict[str, Any]]:
    """Flat retrieval over the DrugBank text columns.

    This is the strongest non-graph baseline available: it ranks drugs by how
    well their narrative text matches the question's terms. It is the kind of
    retrieval `search_drugbank` performs, minus the vector.

    ``websearch_to_tsquery`` with OR semantics is used deliberately. A plain
    ``plainto_tsquery`` ANDs every term, so a multi-word question containing one
    absent word returns nothing at all — that would be a straw man rather than
    a baseline. OR-ranking is the fair reading of "flat retrieval given its
    best shot".
    """
    cur.execute(
        """
        SELECT drugbank_id, name,
               ts_rank(
                 to_tsvector('english',
                   coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
                   coalesce(mechanism_of_action,'') || ' ' || coalesce(indication,'')),
                 websearch_to_tsquery('english', %(q)s)
               ) AS rank
        FROM drugbank_drugs
        WHERE to_tsvector('english',
                coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
                coalesce(mechanism_of_action,'') || ' ' || coalesce(indication,''))
              @@ websearch_to_tsquery('english', %(q)s)
        ORDER BY rank DESC
        LIMIT %(limit)s
        """,
        {"q": " OR ".join(w for w in terms.split() if w), "limit": limit},
    )
    return [dict(r) for r in cur.fetchall()]


def flat_lookup_interaction(cur: Any, drug_a: str, drug_b: str) -> list[dict[str, Any]]:
    """Flat path for "do A and B interact": read A's interaction list.

    Lucent has no tool that joins two drugs; the closest flat approach is to
    pull one drug's interaction array and filter it in the caller. This shows
    what that costs and what it returns.
    """
    cur.execute(
        """
        SELECT d.name AS source, e->>'name' AS target_name,
               left(e->>'description', 200) AS note
        FROM drugbank_drugs d, jsonb_array_elements(d.drug_interactions) e
        WHERE d.name = %(a)s AND e->>'name' = %(b)s
        """,
        {"a": drug_a, "b": drug_b},
    )
    return [dict(r) for r in cur.fetchall()]


# Questions chosen so that each one has a graph answer, and the flat baseline
# is given its best shot at the same question.
QUESTIONS: list[dict[str, Any]] = [
    {
        "id": "q1_shared_targets",
        "question": "与帕罗西汀共享靶点的其他药物有哪些？",
        "flat_terms": "paroxetine serotonin reuptake target",
        "graph": {
            "cypher": """
                MATCH (d:Drug {name: 'Paroxetine'})-[r1]->(t:Protein)<-[r2]-(o:Drug)
                WHERE id(o) <> id(d)
                RETURN t.name AS target, count(DISTINCT o) AS n,
                       collect(DISTINCT o.name)[0..4] AS sample
                ORDER BY n DESC LIMIT 8
            """,
        },
        "flat_note": "扁平检索只能返回帕罗西汀自己的文本段落，无法给出「其他药物」",
    },
    {
        "id": "q2_cyp_ddi",
        "question": "抑制 CYP2D6 的药物中，哪些药物同时是 CYP2D6 的底物？（自相互作用风险）",
        "flat_terms": "CYP2D6 inhibitor substrate metabolism",
        "graph": {
            "cypher": """
                MATCH (a:Drug)-[:INHIBITS]->(p:Protein {gene_name: 'CYP2D6'})
                MATCH (b:Drug)-[:SUBSTRATE_OF]->(p)
                WHERE id(a) <> id(b)
                RETURN a.name AS inhibitor, b.name AS substrate
                ORDER BY a.name, b.name LIMIT 10
            """,
        },
        "flat_note": "扁平检索无法区分同一酶上的「抑制方」与「底物方」两种角色",
    },
    {
        "id": "q3_interaction_confirmed",
        "question": "帕罗西汀与哪些「以 CYP 为底物且被帕罗西汀抑制」的药物有实际相互作用记录？",
        "flat_terms": "paroxetine drug interaction",
        "graph": {
            "cypher": """
                MATCH (a:Drug {name: 'Paroxetine'})-[:INHIBITS]->(p:Protein)
                      <-[:SUBSTRATE_OF]-(b:Drug)
                WITH a, p, b LIMIT 200
                MATCH (a)-[i:INTERACTS_WITH]-(b)
                RETURN b.name AS drug, p.gene_name AS enzyme,
                       left(i.description, 140) AS note
                ORDER BY b.name LIMIT 10
            """,
        },
        "flat_note": "需要机制（类型化 2 跳）与相互作用记录（无类型 1 跳）联立",
    },
    {
        "id": "q4_cascade",
        "question": "帕罗西汀 → 中间药 → 终药的级联代谢链",
        "flat_terms": "paroxetine metabolism cascade",
        "graph": {
            "cypher": """
                MATCH (a:Drug {name: 'Paroxetine'})-[:INHIBITS]->(e1:Protein)
                      <-[:SUBSTRATE_OF]-(c:Drug)
                MATCH (c)-[:INHIBITS]->(e2:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
                WHERE id(c) <> id(a) AND id(b) <> id(a) AND id(b) <> id(c)
                  AND id(e1) <> id(e2)
                RETURN e1.gene_name AS enz1, c.name AS middle,
                       e2.gene_name AS enz2, b.name AS end_drug
                LIMIT 10
            """,
        },
        "flat_note": "4 跳类型化链，扁平检索没有任何等价表达",
    },
]


def main() -> None:
    settings = get_settings()
    pool = StorePool(settings)
    with pool.borrow() as store:
        run_comparison(store)


def run_comparison(store: Neo4jGraphStore) -> None:
    stats = store.get_stats()
    print("== graph under test ==")
    print(f"  nodes={stats.get('node_count')} edges={stats.get('relationship_count')}")
    conn = pg()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    report: list[dict[str, Any]] = []

    try:
        for q in QUESTIONS:
            print("\n" + "=" * 78)
            print(f"[{q['id']}] {q['question']}")
            print(f"  扁平基线说明: {q['flat_note']}")

            t0 = time.perf_counter()
            try:
                gres = store.execute_query(q["graph"]["cypher"].strip(), {})
                grows = gres.get("records", []) if gres.get("success") else []
                gerr = None if gres.get("success") else gres.get("error")
            except Exception as exc:  # noqa: BLE001
                grows, gerr = [], f"{type(exc).__name__}: {exc}"
            gms = (time.perf_counter() - t0) * 1000

            suffix = f" ERR={gerr}" if gerr else ""
            print(f"\n  [OAG 图遍历] {len(grows)} 行 / {gms:.0f} ms{suffix}")
            for row in grows[:5]:
                print(f"      {row}")

            t0 = time.perf_counter()
            frows = flat_search(cur, q["flat_terms"], limit=8)
            fms = (time.perf_counter() - t0) * 1000
            print(f"\n  [扁平全文检索] {len(frows)} 行 / {fms:.0f} ms  (query={q['flat_terms']!r})")
            for row in frows[:5]:
                print(f"      {row['name']} ({row['drugbank_id']}) rank={row['rank']:.4f}")

            report.append(
                {
                    "id": q["id"],
                    "question": q["question"],
                    "flat_note": q["flat_note"],
                    "graph_rows": len(grows),
                    "graph_ms": round(gms, 1),
                    "graph_error": gerr,
                    "graph_sample": grows[:8],
                    "flat_rows": len(frows),
                    "flat_ms": round(fms, 1),
                    "flat_sample": [r["name"] for r in frows],
                }
            )

        # A concrete "no flat equivalent" case, run both ways.
        print("\n" + "=" * 78)
        print("[q5_two_drug_interaction] 帕罗西汀 与 曲马多 是否直接相互作用？")
        t0 = time.perf_counter()
        ires = store.execute_query(
            """
            MATCH (a:Drug {name: 'Paroxetine'})-[i:INTERACTS_WITH]-(b:Drug {name: 'Tramadol'})
            RETURN a.name AS a, b.name AS b, left(i.description, 200) AS note
            """,
            {},
        )
        ims = (time.perf_counter() - t0) * 1000
        irows = ires.get("records", []) if ires.get("success") else []
        print(f"  [OAG 直接问答] {len(irows)} 行 / {ims:.0f} ms")
        for row in irows[:3]:
            print(f"      {row}")

        t0 = time.perf_counter()
        f2 = flat_lookup_interaction(cur, "Paroxetine", "Tramadol")
        f2ms = (time.perf_counter() - t0) * 1000
        print(f"  [扁平: 读帕罗西汀的相互作用数组再过滤] {len(f2)} 行 / {f2ms:.0f} ms")
        for row in f2[:3]:
            print(f"      {row}")
        print("  注意: 该扁平路径要求调用方已知帕罗西汀是「哪一条」记录，且只查一个方向。")

        report.append(
            {
                "id": "q5_two_drug_interaction",
                "question": "帕罗西汀 与 曲马多 是否直接相互作用？",
                "flat_note": "扁平路径需先把一方整条交互数组取出再在调用方过滤，且单向",
                "graph_rows": len(irows),
                "graph_ms": round(ims, 1),
                "graph_error": None,
                "graph_sample": irows[:5],
                "flat_rows": len(f2),
                "flat_ms": round(f2ms, 1),
                "flat_sample": [r["target_name"] for r in f2],
            }
        )

        with open("out_compare.json", "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2, default=str)
        print("\nwrote out_compare.json")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

"""Run the questions through Lucent's DrugBank tools and compare to the OAG.

Lucent's assistant reaches DrugBank through three tools:

* ``resolve_drugbank`` — Prisma ``findMany`` with OR'd ``contains``
  over name / casNumber / unii / searchText, capped at 5 rows.
* ``get_drugbank_detail`` — one drug row by id.
* ``search_drugbank`` — vector similarity over
  ``drugbank_passage_embeddings``, scoped to one resolved drug id.

This script issues the *same SQL those tools issue* against the dev database,
so the comparison is against the real retrieval path rather than a paraphrase.
The vector table does not exist in this database and `drugbank_passage_chunks`
is empty, so the passage tool returns its "not configured" empty envelope here;
that is itself a finding about the current state, and the flat full-text
baseline from compare_retrieval.py stands in as the retrieval comparison.

    uv run python scripts/compare_lucent.py
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

# Inputs as the tool contract defines them. `resolve_drugbank` is
# described as "Resolve a drug name to a DrugBank entity", and it matches with
# `contains` against name/casNumber/unii/searchText — so the LLM is expected to
# pass a bare entity name, which is what the first group below does. Passing a
# whole question would be an invalid input, not a defect, and is only shown
# separately to document where the boundary is.
#
# The OAG layer is scoped to English DrugBank entities (plan §2, 按语言分工).
# Chinese retrieval is LightRAG's line and is deliberately NOT exercised here:
# asking the English path a Chinese question probes a boundary already decided
# by ADR-0008, not a defect in this layer.
ENTITY_INPUTS = [
    "Paroxetine",
    "Tramadol",
    "CYP2D6",
]

# Documented separately: whole sentences do not match, because the tool is not
# a natural-language resolver.
SENTENCE_INPUTS = [
    "Which other drugs share a target with Paroxetine",
    "Can Paroxetine and Tramadol be taken together",
]


def lucent_resolve(cur: Any, query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Replicates AssistantToolDrugbankEntityResolveService.resolve."""
    cur.execute(
        """
        SELECT drugbank_id, name, cas_number, unii
        FROM drugbank_drugs
        WHERE name ILIKE %(q)s
           OR cas_number ILIKE %(q)s
           OR unii ILIKE %(q)s
           OR search_text ILIKE %(q)s
        ORDER BY name ASC
        LIMIT %(lim)s
        """,
        {"q": f"%{query}%", "lim": limit},
    )
    return [dict(r) for r in cur.fetchall()]


def lucent_detail(cur: Any, drugbank_id: str) -> dict[str, Any] | None:
    """Replicates get_drugbank_detail: a single row, no graph traversal."""
    cur.execute(
        """
        SELECT drugbank_id, name,
               left(coalesce(mechanism_of_action,''), 400) AS mechanism,
               left(coalesce(indication,''), 200) AS indication
        FROM drugbank_drugs WHERE drugbank_id = %(id)s
        """,
        {"id": drugbank_id},
    )
    row = cur.fetchone()
    return dict(row) if row else None


def lucent_passages_available(cur: Any) -> tuple[bool, str]:
    """Is the vector retrieval path usable at all in this database?"""
    cur.execute(
        """
        SELECT count(*) AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name='drugbank_passage_embeddings'
        """
    )
    if cur.fetchone()["n"] == 0:
        return False, "table drugbank_passage_embeddings does not exist"
    cur.execute("SELECT count(*) AS n FROM drugbank_passage_embeddings")
    n = cur.fetchone()["n"]
    if n == 0:
        return False, "drugbank_passage_embeddings exists but is empty"
    return True, f"{n} embeddings"


def main() -> None:
    settings = get_settings()
    pool = StorePool(settings)
    with pool.borrow() as store:
        run_comparison(store)


def run_comparison(store: Neo4jGraphStore) -> None:
    conn = psycopg2.connect(SOURCE_DSN)
    conn.set_session(readonly=True)
    try:
        _compare(store, conn)
    finally:
        conn.close()


def _compare(store: Neo4jGraphStore, conn: Any) -> None:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    ok, why = lucent_passages_available(cur)
    print("== Lucent retrieval path availability ==")
    print(f"  search_drugbank usable: {ok}  ({why})")
    print("  resolve_drugbank: usable (Prisma over drugbank_drugs)")
    print("  get_drugbank_detail:     usable (single row)")

    report: list[dict[str, Any]] = []

    print("\n== 按工具契约输入（裸实体名）==")
    for question in ENTITY_INPUTS:
        print("\n" + "=" * 78)
        print(f"输入: {question}")

        t0 = time.perf_counter()
        entities = lucent_resolve(cur, question)
        rms = (time.perf_counter() - t0) * 1000
        print(f"\n  [Lucent resolve_drugbank] {len(entities)} 行 / {rms:.0f} ms")
        for e in entities[:5]:
            print(f"      {e['name']} ({e['drugbank_id']})")
        if not entities:
            print("      (无匹配)")

        # If one drug resolved, show what its detail row offers for the question.
        if len(entities) == 1:
            t0 = time.perf_counter()
            detail = lucent_detail(cur, entities[0]["drugbank_id"])
            dms = (time.perf_counter() - t0) * 1000
            print(f"  [Lucent get_drugbank_detail] 1 行 / {dms:.0f} ms")
            if detail:
                print(f"      mechanism: {detail['mechanism'][:110]!r}")

        print("  [Lucent search_drugbank] -> 不可用（见上）" if not ok else "")

        report.append(
            {
                "kind": "entity_input",
                "question": question,
                "lucent_resolve_rows": len(entities),
                "lucent_resolve_ms": round(rms, 1),
                "lucent_entities": [e["name"] for e in entities],
                "lucent_passages_usable": ok,
                "lucent_passages_reason": why,
            }
        )

    print("\n" + "=" * 78)
    print("== 越出工具契约的输入（整句）—— 记录边界，非缺陷 ==")
    print("resolve_drugbank 的描述是「Resolve a drug name」，用 contains 匹配；")
    print("整句不是它接受的输入。以下仅用于说明边界在哪：")
    for sentence in SENTENCE_INPUTS:
        rows = lucent_resolve(cur, sentence)
        print(f"  {sentence!r:52} -> {len(rows)} 行")

    # The directly comparable pair: "can these two be taken together?"
    print("\n" + "=" * 78)
    print("对照: 「Paroxetine 与 Tramadol 能否同服」两侧各自能给出什么")
    t0 = time.perf_counter()
    res = store.execute_query(
        """
        MATCH (a:Drug {name:'Paroxetine'})-[i:INTERACTS_WITH]-(b:Drug {name:'Tramadol'})
        RETURN a.name AS a, b.name AS b, i.description AS note
        """,
        {},
    )
    gms = (time.perf_counter() - t0) * 1000
    grows = res.get("records", []) if res.get("success") else []
    print(f"\n  [OAG] {len(grows)} 行 / {gms:.0f} ms")
    for row in grows:
        print(f"      {row['a']} × {row['b']}: {row['note'][:150]}")

    # Lucent side: resolve each drug, then read its interaction array.
    t0 = time.perf_counter()
    cur.execute(
        """
        SELECT d.name AS src, e->>'name' AS dst, left(e->>'description',150) AS note
        FROM drugbank_drugs d, jsonb_array_elements(d.drug_interactions) e
        WHERE d.name IN ('Paroxetine','Tramadol') AND e->>'name' IN ('Paroxetine','Tramadol')
        """,
    )
    lrows = [dict(r) for r in cur.fetchall()]
    lms = (time.perf_counter() - t0) * 1000
    print(f"\n  [Lucent 现有工具组合] {len(lrows)} 行 / {lms:.0f} ms")
    for row in lrows:
        print(f"      {row['src']} -> {row['dst']}: {row['note']}")
    print("      注意: Lucent 无「两药相互作用」工具；须由模型自行")
    print("            先 resolve 两次、再拉两边的 drug_interactions 数组并比对。")

    report.append(
        {
            "question": "Paroxetine 与 Tramadol 能否同服（英文实体）",
            "oag_rows": len(grows),
            "oag_ms": round(gms, 1),
            "oag_sample": grows[:3],
            "lucent_rows": len(lrows),
            "lucent_ms": round(lms, 1),
            "lucent_sample": lrows[:3],
            "lucent_note": "需两次 resolve 后各自拉取 drug_interactions 数组在模型侧比对",
        }
    )

    with open("out_compare_lucent.json", "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, default=str)
    print("\nwrote out_compare_lucent.json")


if __name__ == "__main__":
    main()

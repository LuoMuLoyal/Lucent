"""Export a mid-sized DrugBank subgraph from Lucent's Postgres tables to JSONL.

Read-only against the source database. The pilot used an 86-drug induced
subgraph over ATC N06A|N02C; this widens the scope by ATC class so the graph
exercises cross-class paths while staying small enough to load in minutes
rather than hours.

Scope is expressed as a set of ATC level-4 prefixes plus an optional drug-name
anchor list, matching how the pilot defined its cut.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

SOURCE_DSN = "host=127.0.0.1 port=15432 dbname=lucent user=postgres password=postgres"

# Clinically coherent ATC level-4 classes, chosen so the graph has:
#   * the cytochrome P450 / transporter hub targets shared across classes
#   * several drug classes that interact through those hubs
#   * anchor drugs whose multi-hop chains are known (serotonin syndrome etc.)
SCOPE_PREFIXES = [
    "N06A",  # antidepressants
    "N02C",  # antimigraine / triptans
    "N05A",  # antipsychotics
    "N05C",  # hypnotics and sedatives
    "N03A",  # antiepileptics
    "N04B",  # dopaminergic
    "N07B",  # drugs used in addictive disorders
    "M01A",  # NSAIDs
    "A02B",  # drugs for peptic ulcer / PPIs
    "C10A",  # lipid modifying / statins
    "B01A",  # antithrombotics
    "A10B",  # blood glucose lowering (non-insulin)
    "J01C",  # beta-lactam antibacterials
    "J01D",  # other beta-lactam
    "J01F",  # macrolides
    "J02A",  # antifungals
    "L01X",  # antineoplastics, other
    "L04A",  # immunosuppressants
    "R06A",  # antihistamines
    "G04B",  # urologicals
]

ANCHORS = [
    "Tramadol",
    "Linezolid",
    "Dextromethorphan",
    "Methylene blue",
    "Amiodarone",
    "Haloperidol",
    "Methotrexate",
    "Warfarin",
    "Clopidogrel",
    "Digoxin",
    "Colchicine",
    "Simvastatin",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data",
        help="Output directory for the JSONL files.",
    )
    parser.add_argument(
        "--prefixes",
        nargs="*",
        default=SCOPE_PREFIXES,
        help="ATC level-4 prefixes defining the drug scope.",
    )
    parser.add_argument(
        "--extra-prefixes",
        nargs="*",
        default=[],
        help="Additional ATC level-4 prefixes to widen the scope.",
    )
    return parser.parse_args()


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, default=str))
            handle.write("\n")


def scalar(cur: psycopg2.extensions.cursor) -> int:
    """Read a single integer from a one-column, one-row query.

    The result rows here are dicts (``RealDictCursor``), and ``fetchone()`` is
    typed as optional; every caller has just run a ``count(*)`` that always
    returns exactly one row.
    """
    row: Any = cur.fetchone()
    if row is None:
        raise RuntimeError("expected exactly one row")
    return int(row["n"])


def main() -> None:
    args = parse_args()
    prefixes = list(args.prefixes) + list(args.extra_prefixes)
    args.out.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(SOURCE_DSN)
    conn.set_session(readonly=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print(f"== scoping to {len(prefixes)} ATC prefixes ==")
    # The scope is a CTE rather than a temp table: the session is read-only, so
    # a temp table write is refused, and keeping it read-only is worth more
    # than the marginal readability of a named table.
    scope_cte = """
        WITH sel_drugs AS (
            SELECT DISTINCT d.drugbank_id
            FROM drugbank_drugs d
            WHERE EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(d.atc_codes) c
                    WHERE left(c, 4) = ANY(%(prefixes)s)
                  )
               OR d.name = ANY(%(anchors)s)
        )
    """
    params = {"prefixes": prefixes, "anchors": ANCHORS}

    cur.execute(scope_cte + "SELECT count(*) AS n FROM sel_drugs", params)
    n_drugs = scalar(cur)
    print(f"  selected drugs: {n_drugs}")

    cur.execute(
        scope_cte
        + """
        SELECT count(DISTINCT t.drugbank_id) AS n
        FROM drugbank_drug_targets t
        WHERE t.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        """,
        params,
    )
    print(f"  with target edges: {scalar(cur)}")

    # --- drugs ---
    cur.execute(
        scope_cte
        + """
        SELECT d.drugbank_id AS id, d.name, d.unii, d.drug_type,
               d.groups, d.synonyms, d.categories, d.atc_codes,
               d.indication, d.mechanism_of_action, d.half_life,
               d.protein_binding, d.toxicity, d.description, d.cas_number
        FROM drugbank_drugs d
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY d.drugbank_id
        """,
        params,
    )
    drugs = [dict(r) for r in cur.fetchall()]
    print(f"  drugs rows: {len(drugs)}")

    # --- targets reachable from those drugs ---
    cur.execute(
        scope_cte
        + """
        , target_ids AS (
            SELECT DISTINCT t.target_id
            FROM drugbank_drug_targets t
            WHERE t.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        )
        SELECT id, name, gene_name, uniprot_id, uniprot_title, species,
               genbank_protein_id, hgnc_id
        FROM drugbank_targets
        WHERE id IN (SELECT target_id FROM target_ids)
        ORDER BY id
        """,
        params,
    )
    targets = [dict(r) for r in cur.fetchall()]
    print(f"  targets rows: {len(targets)}")

    # --- drug -> target edges ---
    cur.execute(
        scope_cte
        + """
        SELECT t.drugbank_id AS source, t.target_id AS target,
               t.relation_kind, t.actions, t.known_action
        FROM drugbank_drug_targets t
        WHERE t.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY t.drugbank_id, t.target_id, t.relation_kind
        """,
        params,
    )
    drug_target_edges = [dict(r) for r in cur.fetchall()]
    print(f"  drug->target edges: {len(drug_target_edges)}")

    # --- drug -> drug interactions, induced on the selected set ---
    cur.execute(
        scope_cte
        + """
        SELECT d.drugbank_id AS source,
               e->>'drugbankId' AS target,
               e->>'description' AS description,
               e->>'name' AS target_name
        FROM drugbank_drugs d, jsonb_array_elements(d.drug_interactions) e
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
          AND e->>'drugbankId' IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY 1, 2
        """,
        params,
    )
    drug_drug_edges = [dict(r) for r in cur.fetchall()]
    print(f"  drug->drug edges: {len(drug_drug_edges)}")

    # --- ATC nodes + drug -> ATC edges ---
    atc_rows: dict[str, dict[str, Any]] = {}
    atc_edges: list[dict[str, Any]] = []
    cur.execute(
        scope_cte
        + """
        SELECT d.drugbank_id AS drugbank_id, c AS code
        FROM drugbank_drugs d, jsonb_array_elements_text(d.atc_codes) c
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY 1, 2
        """,
        params,
    )
    for row in cur.fetchall():
        code = row["code"]
        atc_edges.append({"source": row["drugbank_id"], "target": code})
        # Materialise every ancestor level so the class hierarchy is connected.
        for depth in (1, 3, 4, 5, 7):
            prefix = code[:depth]
            if len(prefix) < 3:
                continue
            atc_rows.setdefault(
                prefix,
                {"code": prefix, "level": len(prefix), "parent": code[: depth - 1] or None},
            )
    atc_nodes = [atc_rows[k] for k in sorted(atc_rows)]
    print(f"  atc nodes: {len(atc_nodes)}  atc edges: {len(atc_edges)}")

    write_jsonl(args.out / "drugs.jsonl", drugs)
    write_jsonl(args.out / "targets.jsonl", targets)
    write_jsonl(args.out / "atc_nodes.jsonl", atc_nodes)
    write_jsonl(args.out / "edges_drug_target.jsonl", drug_target_edges)
    write_jsonl(args.out / "edges_drug_drug.jsonl", drug_drug_edges)
    write_jsonl(args.out / "edges_drug_atc.jsonl", atc_edges)

    print("\n== summary ==")
    print(f"  nodes: {len(drugs)} drugs + {len(targets)} targets + {len(atc_nodes)} atc")
    print(
        f"  edges: {len(drug_target_edges)} drug->target"
        f" + {len(drug_drug_edges)} drug->drug"
        f" + {len(atc_edges)} drug->atc"
        f" = {len(drug_target_edges) + len(drug_drug_edges) + len(atc_edges)}"
    )
    conn.close()


if __name__ == "__main__":
    main()

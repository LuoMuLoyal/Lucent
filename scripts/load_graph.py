"""Load the exported DrugBank subgraph into AGE's lucent_graph in bulk.

Building is a deterministic schema mapping from structured DrugBank fields —
no LLM extraction, so every edge is traceable to a source column.

The pilot measured per-row ``create_relationship()`` at ~45 edges/s, which on
this graph (209k edges) would take over an hour. Nodes are therefore created
with one ``UNWIND`` per batch and edges likewise, which the pilot measured at
~1571 edges/s. The batches are issued as raw Cypher through the store's
connection rather than through per-row helper calls, because the helper API is
what imposed the per-row round trip.

    uv run python scripts/load_graph.py --data data
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from semantica.graph_store.age_store import ApacheAgeStore

from semantica_service.config import get_settings

# Action verb -> relationship type. DrugBank's `actions` array is the
# structured field that makes this a mapping rather than an extraction.
ACTION_EDGE = {
    "inhibitor": "INHIBITS",
    "substrate": "SUBSTRATE_OF",
    "inducer": "INDUCES",
    "antagonist": "ANTAGONIZES",
    "agonist": "AGONIZES",
    "partial agonist": "AGONIZES",
    "inverse agonist": "ANTAGONIZES",
    "binder": "BINDS",
    "ligand": "BINDS",
    "modulator": "MODULATES",
    "allosteric modulator": "MODULATES",
    "negative modulator": "MODULATES",
    "positive modulator": "MODULATES",
    "positive allosteric modulator": "MODULATES",
    "inhibitory allosteric modulator": "MODULATES",
    "activator": "ACTIVATES",
    "blocker": "BLOCKS",
    "regulator": "REGULATES",
    "downregulator": "DOWNREGULATES",
    "upregulator": "UPREGULATES",
    "potentiator": "POTENTIATES",
    "stimulator": "ACTIVATES",
    "transporter": "TRANSPORTED_BY",
    "carrier": "CARRIED_BY",
    "inactivator": "INACTIVATES",
}

# relation_kind -> the edge used when a row carries no recognised action verb.
KIND_EDGE = {
    "target": "TARGETS",
    "enzyme": "ACTS_ON",
    "transporter": "TRANSPORTED_BY",
    "carrier": "CARRIED_BY",
    "all": "TARGETS",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--batch", type=int, default=2000, help="Rows per UNWIND.")
    parser.add_argument(
        "--limit-drugs",
        type=int,
        default=0,
        help="Load only the first N drugs (0 = all); useful for a fast smoke run.",
    )
    return parser.parse_args()


def batched[T](rows: list[T], size: int) -> Iterator[list[T]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def cypher_value(value: Any) -> str:
    """Render one Python value as a Cypher literal.

    Nested maps and lists recurse: an unhandled dict would otherwise fall
    through to ``str()`` and produce a Python repr (``{'a': 1}``), which AGE
    accepts as a *string* — so the batch would load without error while the
    edge property silently held nonsense.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        return cypher_map(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(cypher_value(item) for item in value) + "]"
    # json.dumps gives a valid Cypher string literal: the escaping rules for
    # quotes, backslashes and control characters are the same.
    return json.dumps(str(value), ensure_ascii=False)


def cypher_map(row: dict[str, Any]) -> str:
    """Render one row as a Cypher map literal.

    AGE's Cypher differs from JSON here: a map key must be an identifier, so
    ``{"drugbank_id": ...}`` is a syntax error. Keys are emitted bare and the
    values are quoted individually.
    """
    inner = ", ".join(f"{key}: {cypher_value(value)}" for key, value in row.items())
    return "{" + inner + "}"


def cypher_list(rows: Iterable[dict[str, Any]]) -> str:
    """Render rows as a Cypher list-of-maps literal.

    ``$param`` binding is used for scalars elsewhere, but AGE's parameter
    handling for a list of maps is unreliable, so the batch is rendered
    directly. All values are data this script produced from the source tables
    rather than caller input, and each is escaped by ``cypher_value``.
    """
    return "[" + ", ".join(cypher_map(row) for row in rows) + "]"


def run(store: ApacheAgeStore, query: str) -> dict[str, Any]:
    result: dict[str, Any] = store.execute_query(query)
    if not result.get("success"):
        raise RuntimeError(f"Cypher failed: {result.get('error')}\n{query[:400]}")
    return result


def clear_graph(store: ApacheAgeStore, labels: list[str]) -> None:
    """Delete existing nodes one label at a time.

    AGE's Cypher subset has no multi-label match — ``(n:A|B)`` is a syntax
    error — so the labels cannot be combined into one statement.
    """
    for label in labels:
        run(store, f"MATCH (n:{label}) DETACH DELETE n")


def build_nodes(store: ApacheAgeStore, label: str, rows: list[dict[str, Any]], batch: int) -> int:
    """Create ``label`` nodes from pre-built property rows.

    Each row already carries its own identifier (``drugbank_id`` or ``id``), so
    there is no separate key field to pass.
    """
    total = 0
    for chunk in batched(rows, batch):
        payload = cypher_list(chunk)
        # `id` is stored alongside the original property so the export bridge
        # finds the same identifier on nodes and edges; see graph/export.py.
        query = f"UNWIND {payload} AS row CREATE (n:{label}) SET n = row RETURN count(n) AS created"
        result = run(store, query)
        total += int(result["records"][0]["created"])
        print(f"    {label}: {total}/{len(rows)}", end="\r", flush=True)
    print()
    return total


def build_edges(
    store: ApacheAgeStore,
    rel_type: str,
    pairs: list[dict[str, Any]],
    batch: int,
) -> int:
    """Create edges between nodes matched on their identifying property.

    Nodes are matched on ``drugbank_id`` / ``id`` rather than on AGE row ids,
    so the load does not depend on insert order.

    ``SET r = row.props`` is rejected by AGE ("SET clause expects a map"), so
    each property is assigned individually from the edge's own map.
    """
    if not pairs:
        return 0
    # Edge properties differ per relationship type; the key set is taken from
    # the first row and every row carries the same one.
    prop_keys = sorted(pairs[0]["props"])
    assignments = " ".join(f"SET r.{key} = row.props.{key}" for key in prop_keys)

    total = 0
    for chunk in batched(pairs, batch):
        payload = cypher_list(chunk)
        query = (
            f"UNWIND {payload} AS row "
            f"MATCH (a {{drugbank_id: row.source}}) "
            f"MATCH (b {{id: row.target}}) "
            f"CREATE (a)-[r:{rel_type}]->(b) "
            f"{assignments} "
            f"RETURN count(r) AS created"
        )
        result = run(store, query)
        total += int(result["records"][0]["created"])
        print(f"    {rel_type}: {total}/{len(pairs)}", end="\r", flush=True)
    print()
    return total


def atc_parent(code: str) -> str | None:
    """Return the parent ATC code, or ``None`` at the top of the hierarchy.

    ATC levels are not a uniform one-character step: the chemical-substance
    level is 7 characters (``N06AB05``) and its parent, the chemical subgroup,
    is 5 (``N06AB``) — so the step is 2 there and 1 everywhere else. Stripping
    a single character would leave every level-7 node unattached.
    """
    if len(code) == 7:
        return code[:5]
    if len(code) > 1:
        return code[:-1]
    return None


def build_atc_hierarchy_edges(
    store: ApacheAgeStore, pairs: list[dict[str, Any]], batch: int
) -> int:
    """Create ATCClass -> ATCClass edges.

    ATC nodes are matched on ``code`` rather than ``drugbank_id``, so they need
    their own matcher; the generic one matches source nodes on ``drugbank_id``.
    """
    if not pairs:
        return 0
    total = 0
    for chunk in batched(pairs, batch):
        payload = cypher_list(chunk)
        query = (
            f"UNWIND {payload} AS row "
            f"MATCH (a:ATCClass {{code: row.source}}) "
            f"MATCH (b:ATCClass {{code: row.target}}) "
            f"CREATE (a)-[:SUBCLASS_OF]->(b) "
            f"RETURN count(*) AS created"
        )
        result = run(store, query)
        total += int(result["records"][0]["created"])
        print(f"    SUBCLASS_OF: {total}/{len(pairs)}", end="\r", flush=True)
    print()
    return total


def main() -> None:
    args = parse_args()
    settings = get_settings()
    store = ApacheAgeStore(
        connection_string=settings.age_dsn,
        graph_name=settings.graph_name,
    )
    store.connect()

    drugs = read_jsonl(args.data / "drugs.jsonl")
    targets = read_jsonl(args.data / "targets.jsonl")
    atc = read_jsonl(args.data / "atc_nodes.jsonl")
    e_dt = read_jsonl(args.data / "edges_drug_target.jsonl")
    e_dd = read_jsonl(args.data / "edges_drug_drug.jsonl")
    e_da = read_jsonl(args.data / "edges_drug_atc.jsonl")

    if args.limit_drugs:
        keep = {d["id"] for d in drugs[: args.limit_drugs]}
        drugs = [d for d in drugs if d["id"] in keep]
        e_dt = [e for e in e_dt if e["source"] in keep]
        e_dd = [e for e in e_dd if e["source"] in keep and e["target"] in keep]
        e_da = [e for e in e_da if e["source"] in keep]
        target_ids = {e["target"] for e in e_dt}
        targets = [t for t in targets if t["id"] in target_ids]
        atc_ids = {e["target"] for e in e_da}
        atc = [a for a in atc if a["code"] in atc_ids]
        print(f"limited to {len(drugs)} drugs")

    print("clearing existing graph...")
    clear_graph(store, ["Drug", "Protein", "ATCClass"])

    started = time.perf_counter()

    # Node property payloads. AGE properties cannot be nested maps, so the
    # jsonb/list columns are flattened to JSON strings; the raw arrays stay
    # queryable through the source tables if needed.
    drug_nodes = [
        {
            "drugbank_id": d["id"],
            "id": d["id"],
            "name": d["name"],
            "unii": d["unii"],
            "drug_type": d["drug_type"],
            "groups": json.dumps(d["groups"] or [], ensure_ascii=False),
            "synonyms": json.dumps(d["synonyms"] or [], ensure_ascii=False),
            "categories": json.dumps(d["categories"] or [], ensure_ascii=False),
            "indication": d["indication"] or "",
            "mechanism_of_action": d["mechanism_of_action"] or "",
            "half_life": d["half_life"] or "",
            "protein_binding": d["protein_binding"] or "",
            "cas_number": d["cas_number"] or "",
        }
        for d in drugs
    ]
    target_nodes = [
        {
            "id": t["id"],
            "uniprot_id": t["uniprot_id"] or t["id"],
            "name": t["name"],
            "gene_name": t["gene_name"] or "",
            "uniprot_title": t["uniprot_title"] or t["name"],
            "species": t["species"] or "",
        }
        for t in targets
    ]
    atc_nodes = [{"id": a["code"], "code": a["code"], "level": a["level"]} for a in atc]

    print(f"creating {len(drug_nodes)} Drug nodes...")
    build_nodes(store, "Drug", drug_nodes, args.batch)
    print(f"creating {len(target_nodes)} Protein nodes...")
    build_nodes(store, "Protein", target_nodes, args.batch)
    print(f"creating {len(atc_nodes)} ATCClass nodes...")
    build_nodes(store, "ATCClass", atc_nodes, args.batch)

    # --- drug -> target: one edge per recognised action verb ---
    grouped: dict[str, list[dict[str, Any]]] = {}
    for edge in e_dt:
        verbs = [v for v in (edge.get("actions") or []) if v in ACTION_EDGE]
        kinds = (
            sorted({ACTION_EDGE[v] for v in verbs})
            if verbs
            # No recognised verb: fall back to the structural relation kind so
            # the edge is not silently dropped.
            else [KIND_EDGE.get(edge["relation_kind"] or "all", "TARGETS")]
        )
        for kind in kinds:
            grouped.setdefault(kind, []).append(
                {
                    "source": edge["source"],
                    "target": edge["target"],
                    "props": {
                        "relation_kind": edge["relation_kind"] or "",
                        "known_action": edge["known_action"] or "",
                    },
                }
            )

    print(f"creating drug->target edges across {len(grouped)} relationship types...")
    for rel_type, rows in sorted(grouped.items()):
        build_edges(store, rel_type, rows, args.batch)

    print(f"creating {len(e_dd)} INTERACTS_WITH edges...")
    dd_rows = [
        {
            "source": e["source"],
            "target": e["target"],
            "props": {"description": (e.get("description") or "")[:2000]},
        }
        for e in e_dd
    ]
    build_edges(store, "INTERACTS_WITH", dd_rows, args.batch)

    print(f"creating {len(e_da)} IN_ATC_CLASS edges...")
    da_rows = [{"source": e["source"], "target": e["target"], "props": {}} for e in e_da]
    build_edges(store, "IN_ATC_CLASS", da_rows, args.batch)

    # --- ATC hierarchy: parent class -> child class ---
    # Without these the class levels are isolated nodes: drugs attach to leaf
    # codes only (level 7), so "every drug in N06A" would have no path to
    # follow. The hierarchy is what makes a class-scoped query expressible.
    by_code = {a["code"]: a for a in atc}
    hierarchy: list[dict[str, Any]] = []
    for code in by_code:
        parent = atc_parent(code)
        if parent is not None and parent in by_code:
            hierarchy.append({"source": parent, "target": code, "props": {}})
    print(f"creating {len(hierarchy)} SUBCLASS_OF edges...")
    build_atc_hierarchy_edges(store, hierarchy, args.batch)

    elapsed = time.perf_counter() - started
    stats = store.get_stats()
    print(f"\nloaded in {elapsed:.1f}s")
    print("stats:", stats)
    store.close()


if __name__ == "__main__":
    main()

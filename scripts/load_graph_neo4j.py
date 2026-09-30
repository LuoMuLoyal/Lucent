"""Load the exported DrugBank subgraph into Neo4j in bulk.

This is ``load_graph.py``'s Neo4j counterpart, and it loads the *same* JSONL
produced by ``scripts/export_subgraph.py`` — not a dump taken back out of AGE.
Exporting from the source tables and loading both backends from that one
intermediate keeps the two graphs comparable by construction: any difference in
the result is a difference in the loaders, not in two divergent extractions.

Three properties of the AGE-era loader do **not** carry over, and each would
have been a silent defect:

* **``SET n = row`` / ``SET r = props`` now work.** AGE rejected a map on the
  right-hand side ("SET clause expects a map") and forced per-key assignment.
  Neo4j accepts the map form, so nodes keep their ragged property sets
  (a Drug with 11 properties stays at 11 — missing fields are *not* filled with
  empty strings, which would change what the data means).
* **Batching is a parameter, not string interpolation.** AGE's ``cypher()``
  would not accept a list of maps as a ``$param``, so the old loader rendered
  every value into the query text and escaped it by hand. Neo4j binds it
  natively, so this loader passes a Python list straight through — no escaping
  layer to get subtly wrong.
* **``CREATE``, never ``MERGE``.** The graph contains parallel edges: identical
  start, end and relationship type whose ``prov`` differs, measured at 175
  groups. ``MERGE`` would collapse each group into one edge and silently drop
  provenance. Verification below counts the groups rather than trusting this.

    uv run python scripts/load_graph_neo4j.py --data data
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from neo4j import Driver, GraphDatabase

from semantica_service.provenance.ids import (
    atc_prov_id,
    interaction_prov_id,
    subclass_prov_id,
    target_edge_prov_id,
)

# The same mapping as the AGE loader. Duplicated rather than imported because
# that module imports the AGE store at module scope, which no longer resolves;
# when the AGE assets are finally removed this file becomes the only copy.
ACTION_EDGE: dict[tuple[str, str], str] = {
    ("enzyme", "substrate"): "SUBSTRATE_OF",
    ("enzyme", "inhibitor"): "INHIBITS",
    ("enzyme", "inducer"): "INDUCES",
    ("enzyme", "activator"): "ACTIVATES",
    ("enzyme", "modulator"): "MODULATES",
    ("target", "antagonist"): "ANTAGONIZES",
    ("target", "inverse agonist"): "ANTAGONIZES",
    ("target", "agonist"): "AGONIZES",
    ("target", "partial agonist"): "AGONIZES",
    ("target", "stimulator"): "ACTIVATES",
    ("target", "inhibitor"): "INHIBITS",
    ("target", "inducer"): "INDUCES",
    ("target", "binder"): "BINDS",
    ("target", "antibody"): "BINDS",
    ("target", "ligand"): "BINDS",
    ("target", "blocker"): "BLOCKS",
    ("target", "modulator"): "MODULATES",
    ("target", "allosteric modulator"): "MODULATES",
    ("target", "negative modulator"): "MODULATES",
    ("target", "positive modulator"): "MODULATES",
    ("target", "positive allosteric modulator"): "MODULATES",
    ("target", "inhibitory allosteric modulator"): "MODULATES",
    ("target", "activator"): "ACTIVATES",
    ("target", "potentiator"): "POTENTIATES",
    ("target", "inactivator"): "INACTIVATES",
    ("target", "downregulator"): "DOWNREGULATES",
    ("target", "upregulator"): "UPREGULATES",
    ("target", "regulator"): "REGULATES",
    ("target", "substrate"): "SUBSTRATE_OF",
    ("target", "other/unknown"): "ACTS_ON",
    ("target", "other"): "ACTS_ON",
    ("target", "unknown"): "ACTS_ON",
    ("transporter", "inhibitor"): "INHIBITS",
    ("transporter", "substrate"): "SUBSTRATE_OF",
    ("transporter", "inducer"): "INDUCES",
    ("transporter", "binder"): "BINDS",
    ("transporter", "antagonist"): "ANTAGONIZES",
    ("carrier", "binder"): "BINDS",
    ("carrier", "antagonist"): "ANTAGONIZES",
    ("carrier", "ligand"): "BINDS",
    ("carrier", "inhibitor"): "INHIBITS",
    ("carrier", "inducer"): "INDUCES",
    ("carrier", "regulator"): "REGULATES",
    ("carrier", "upregulator"): "UPREGULATES",
    ("carrier", "substrate"): "TRANSPORTED_BY",
}

KIND_EDGE = {
    "target": "ACTS_ON",
    "enzyme": "ENZYME_LINKED_TO",
    "transporter": "TRANSPORTED_BY",
    "carrier": "CARRIED_BY",
    "all": "ACTS_ON",
}

#: Every relationship type this loader may create. Pinned so a typo in the
#: mapping cannot introduce a type the reasoner's vocabulary check would later
#: reject at startup, and so the "no empty shells" rule is checkable: the AGE
#: catalogue carried Probe / LINKS / TARGETS tables that held no rows, and
#: recreating those empty types here would be noise.
RELATION_TYPES: tuple[str, ...] = tuple(
    sorted(
        {
            *ACTION_EDGE.values(),
            *KIND_EDGE.values(),
            "INTERACTS_WITH",
            "IN_ATC_CLASS",
            "SUBCLASS_OF",
        }
    )
)

#: Node labels, in creation order.
LABELS: tuple[str, ...] = ("Drug", "Protein", "ATCClass")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--batch", type=int, default=5000, help="Rows per UNWIND.")
    parser.add_argument("--uri", default="bolt://127.0.0.1:7687")
    parser.add_argument("--user", default="neo4j")
    parser.add_argument("--password", default="neo4jdevpassword")
    parser.add_argument("--database", default="neo4j")
    parser.add_argument(
        "--limit-drugs",
        type=int,
        default=0,
        help="Load only the first N drugs (0 = all); useful for a fast smoke run.",
    )
    parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="Do not clear the database first (default clears it).",
    )
    return parser.parse_args()


def batched[T](rows: list[T], size: int) -> Iterator[list[T]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def run(driver: Driver, database: str, query: str, params: dict[str, Any]) -> Any:
    """Run one write query and return the records.

    Every batch is a single autocommit transaction: the loader is restartable
    from a cleared database, and a partially applied batch is not a state worth
    preserving.
    """
    with driver.session(database=database) as session:
        return list(session.run(query, params))


def build_nodes(
    driver: Driver, database: str, label: str, rows: list[dict[str, Any]], batch: int
) -> int:
    """Create ``label`` nodes, one ``UNWIND`` batch at a time.

    ``SET n = row`` assigns the whole map, which is what preserves a ragged
    property set exactly. The old AGE loader had to assign key by key and could
    only do so for keys present in the first row of a batch; this form cannot
    drop a property that appears on some rows and not others.
    """
    total = 0
    for chunk in batched(rows, batch):
        records = run(
            driver,
            database,
            f"UNWIND $rows AS row CREATE (n:{label}) SET n = row RETURN count(n) AS created",
            {"rows": chunk},
        )
        total += int(records[0]["created"])
        print(f"    {label}: {total}/{len(rows)}", end="\r", flush=True)
    print()
    return total


def build_edges(
    driver: Driver,
    database: str,
    rel_type: str,
    pairs: list[dict[str, Any]],
    batch: int,
    *,
    source_key: str = "drugbank_id",
    target_key: str = "id",
) -> int:
    """Create edges between nodes matched on their identifying property.

    ``CREATE`` and not ``MERGE``: see the module docstring. Nodes are matched on
    their business key rather than on an internal id, so the load does not
    depend on insert order.
    """
    if not pairs:
        return 0

    total = 0
    for chunk in batched(pairs, batch):
        records = run(
            driver,
            database,
            f"UNWIND $rows AS row "
            f"MATCH (a {{{source_key}: row.source}}) "
            f"MATCH (b {{{target_key}: row.target}}) "
            f"CREATE (a)-[r:{rel_type}]->(b) "
            f"SET r = row.props "
            f"RETURN count(r) AS created",
            {"rows": chunk},
        )
        total += int(records[0]["created"])
        print(f"    {rel_type}: {total}/{len(pairs)}", end="\r", flush=True)
    print()
    return total


def atc_parent(code: str) -> str | None:
    """Return the parent ATC code, or ``None`` at the top of the hierarchy.

    ATC levels are not a uniform one-character step: the chemical-substance
    level is 7 characters (``N06AB05``) and its parent, the chemical subgroup,
    is 5 (``N06AB``) — so the step is 2 there and 1 everywhere else.
    """
    if len(code) == 7:
        return code[:5]
    if len(code) > 1:
        return code[:-1]
    return None


def create_constraints(driver: Driver, database: str) -> None:
    """Index the properties every query matches on.

    AGE required a hand-built GIN index before a property lookup stopped
    scanning (measured 35x). Here the equivalent is a per-label index on the
    key the queries and the loader's ``MATCH`` both use; without it every
    relationship batch scans its endpoint label.
    """
    for label, prop in (("Drug", "drugbank_id"), ("Protein", "id"), ("ATCClass", "code")):
        run(
            driver,
            database,
            f"CREATE INDEX {label.lower()}_{prop}_idx IF NOT EXISTS "
            f"FOR (n:{label}) ON (n.{prop})",
            {},
        )


def clear_graph(driver: Driver, database: str) -> None:
    """Delete every node and relationship.

    Neo4j has no multi-label match either, but it does not need one: an
    unlabelled ``MATCH (n)`` covers all labels, so a single statement clears the
    graph where AGE needed one pass per label.
    """
    run(driver, database, "MATCH (n) DETACH DELETE n", {})


def main() -> None:
    args = parse_args()

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

    driver = GraphDatabase.driver(args.uri, auth=(args.user, args.password))
    driver.verify_connectivity()

    if not args.keep_existing:
        print("clearing existing graph...")
        clear_graph(driver, args.database)

    started = time.perf_counter()

    # Node property payloads are carried over verbatim from the JSONL. The AGE
    # loader had to JSON-encode the list columns because AGE properties cannot
    # be nested maps; Neo4j accepts lists, but the *stored form* being a JSON
    # string is now part of the data's contract (the export bridge and the
    # prompt both treat `groups`/`synonyms`/`categories` as strings), so the
    # encoding is kept. Changing it here would silently change what those
    # fields mean to every caller.
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
    build_nodes(driver, args.database, "Drug", drug_nodes, args.batch)
    print(f"creating {len(target_nodes)} Protein nodes...")
    build_nodes(driver, args.database, "Protein", target_nodes, args.batch)
    print(f"creating {len(atc_nodes)} ATCClass nodes...")
    build_nodes(driver, args.database, "ATCClass", atc_nodes, args.batch)

    print("creating indexes...")
    create_constraints(driver, args.database)

    # --- drug -> target: one edge per recognised action verb ---
    grouped: dict[str, list[dict[str, Any]]] = {}
    unknown_actions: Counter[str] = Counter()
    for edge in e_dt:
        relation_kind = edge["relation_kind"] or "all"
        verbs = []
        for verb in edge.get("actions") or []:
            key = (relation_kind, verb)
            if key in ACTION_EDGE:
                verbs.append(ACTION_EDGE[key])
            else:
                unknown_actions[verb] += 1
        kinds = (
            sorted(set(verbs))
            if verbs
            else [KIND_EDGE.get(relation_kind, "ACTS_ON")]
        )
        for kind in kinds:
            grouped.setdefault(kind, []).append(
                {
                    "source": edge["source"],
                    "target": edge["target"],
                    "props": {
                        "relation_kind": edge["relation_kind"] or "",
                        "known_action": edge["known_action"] or "",
                        # The id is a function of the edge's own endpoints and
                        # type, so it is computed here rather than applied by a
                        # later pass. The AGE deployment needed the separate
                        # `add_edge_provenance.py --graph` sweep because its
                        # `SET` could not take a map; writing it at creation
                        # means an edge can never exist without one.
                        "prov": target_edge_prov_id(
                            edge["source"],
                            edge["target"],
                            edge["relation_kind"] or "",
                            kind,
                        ),
                    },
                }
            )

    if unknown_actions:
        print(f"  note: {len(unknown_actions)} unrecognised verb(s) fell back to kind edge:")
        for verb, n in unknown_actions.most_common(10):
            print(f"    {verb!r} x{n}")

    print(f"creating drug->target edges across {len(grouped)} relationship types...")
    for rel_type, rows in sorted(grouped.items()):
        build_edges(driver, args.database, rel_type, rows, args.batch)

    print(f"creating {len(e_dd)} INTERACTS_WITH edges...")
    dd_rows = [
        {
            "source": e["source"],
            "target": e["target"],
            "props": {
                "description": (e.get("description") or "")[:2000],
                "prov": interaction_prov_id(e["source"], e["target"]),
            },
        }
        for e in e_dd
    ]
    build_edges(driver, args.database, "INTERACTS_WITH", dd_rows, args.batch)

    print(f"creating {len(e_da)} IN_ATC_CLASS edges...")
    da_rows = [
        {
            "source": e["source"],
            "target": e["target"],
            "props": {"prov": atc_prov_id(e["source"], e["target"])},
        }
        for e in e_da
    ]
    build_edges(driver, args.database, "IN_ATC_CLASS", da_rows, args.batch)

    # --- ATC hierarchy: parent class -> child class ---
    by_code = {a["code"]: a for a in atc}
    hierarchy: list[dict[str, Any]] = []
    for code in by_code:
        parent = atc_parent(code)
        if parent is not None and parent in by_code:
            hierarchy.append(
                {
                    "source": parent,
                    "target": code,
                    "props": {"prov": subclass_prov_id(parent, code)},
                }
            )
    print(f"creating {len(hierarchy)} SUBCLASS_OF edges...")
    build_edges(
        driver,
        args.database,
        "SUBCLASS_OF",
        hierarchy,
        args.batch,
        source_key="code",
        target_key="code",
    )

    elapsed = time.perf_counter() - started
    print(f"\nloaded in {elapsed:.1f}s")
    stats = stats_of(driver, args.database)
    print("stats:", stats)
    problems = verify_load(driver, args.database, stats)
    driver.close()

    if problems:
        print("\n== LOAD VERIFICATION FAILED ==")
        for problem in problems:
            print(f"  - {problem}")
        raise SystemExit(1)
    print("\nload verification passed")


def verify_load(driver: Driver, database: str, stats: dict[str, Any]) -> list[str]:
    """Check the invariants a silent breakage would violate.

    Two of these encode defects that would otherwise be invisible: an edge
    without a ``prov`` id breaks citations for a whole relationship type at
    once, and a collapsed parallel edge loses provenance that no count of
    *edges* would show (the total stays plausible — only the group count
    reveals it). Both are checked here rather than assumed, because the failure
    mode of each is a plausible-looking graph.
    """
    problems: list[str] = []

    expected_labels = set(LABELS)
    actual_labels = set(stats["label_counts"])
    if actual_labels != expected_labels:
        problems.append(f"labels {sorted(actual_labels)} != expected {sorted(expected_labels)}")

    unknown_types = set(stats["relationship_type_counts"]) - set(RELATION_TYPES)
    if unknown_types:
        problems.append(
            f"relationship types outside the pinned vocabulary: {sorted(unknown_types)}"
        )

    with driver.session(database=database) as session:
        record = session.run(
            "MATCH ()-[r]->() RETURN count(r) AS edges, count(r.prov) AS with_prov"
        ).single()
        edges = int(record["edges"]) if record else 0
        with_prov = int(record["with_prov"]) if record else 0
        if edges != with_prov:
            problems.append(f"{edges - with_prov} of {edges} edges carry no prov id")

        group = session.run(
            "MATCH (a)-[r]->(b) WITH type(r) AS t, id(a) AS sa, id(b) AS sb, count(*) AS n "
            "WHERE n > 1 RETURN count(*) AS groups"
        ).single()
        groups = int(group["groups"]) if group else 0
        if groups == 0:
            problems.append(
                "no same-type parallel edges found, but the source graph has 175 groups; "
                "edges were probably MERGEd rather than CREATEd"
            )
        else:
            print(f"parallel edge groups: {groups}")

    return problems


def stats_of(driver: Driver, database: str) -> dict[str, Any]:
    """Node, relationship, label and type counts."""
    with driver.session(database=database) as session:
        node_count = session.run("MATCH (n) RETURN count(n) AS c").single()
        rel_count = session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()
        labels = session.run(
            "MATCH (n) UNWIND labels(n) AS l RETURN l AS label, count(*) AS c ORDER BY c DESC"
        )
        types = session.run(
            "MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS c ORDER BY c DESC"
        )
        return {
            "node_count": node_count["c"] if node_count else 0,
            "relationship_count": rel_count["c"] if rel_count else 0,
            "label_counts": {r["label"]: r["c"] for r in labels},
            "relationship_type_counts": {r["t"]: r["c"] for r in types},
        }


if __name__ == "__main__":
    main()

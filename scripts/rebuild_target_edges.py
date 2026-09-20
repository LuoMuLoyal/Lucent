"""Rebuild only the drug -> target edges under the corrected mapping.

The 20 万 INTERACTS_WITH edges and all nodes are untouched: only the ~5 000
drug/target relationships change, because only their verb->type mapping was
wrong. This is the cheap alternative to a full 31-minute reload.

    uv run python scripts/rebuild_target_edges.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from semantica.graph_store.age_store import ApacheAgeStore

from semantica_service.config import get_settings

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_graph import (  # noqa: E402
    ACTION_EDGE,
    KIND_EDGE,
    build_edges,
    read_jsonl,
    run,
)

# Every relationship type the old and new mappings could have produced, so the
# delete covers edges created by either.
PURGE_TYPES = [
    "SUBSTRATE_OF",
    "INHIBITS",
    "INDUCES",
    "ACTIVATES",
    "ANTAGONIZES",
    "AGONIZES",
    "BINDS",
    "BLOCKS",
    "MODULATES",
    "POTENTIATES",
    "INACTIVATES",
    "DOWNREGULATES",
    "UPREGULATES",
    "REGULATES",
    "ACTS_ON",
    "TRANSPORTED_BY",
    "CARRIED_BY",
    "ENZYME_LINKED_TO",
    "TARGETS",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--batch", type=int, default=2000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    store = ApacheAgeStore(connection_string=settings.age_dsn, graph_name=settings.graph_name)
    store.connect()

    print("== deleting existing drug->target edges ==")
    # DETACH DELETE n is not needed: only the relationship is removed, and both
    # endpoints stay (they are shared with other relationship types).
    for rel_type in PURGE_TYPES:
        query = f"MATCH ()-[r:{rel_type}]->() DELETE r RETURN count(r) AS n"
        try:
            result = run(store, query)
            n = int(result["records"][0]["n"])
        except Exception as exc:  # noqa: BLE001 - report and continue per type
            print(f"  {rel_type}: skipped ({exc})")
            continue
        if n:
            print(f"  {rel_type}: deleted {n}")

    print("\n== re-deriving edges under (relation_kind, action) ==")
    e_dt: list[dict[str, Any]] = read_jsonl(args.data / "edges_drug_target.jsonl")
    grouped: dict[str, list[dict[str, Any]]] = {}
    fallback = 0
    for edge in e_dt:
        relation_kind = edge["relation_kind"] or "all"
        verbs = []
        for verb in edge.get("actions") or []:
            key = (relation_kind, verb)
            if key in ACTION_EDGE:
                verbs.append(ACTION_EDGE[key])
            else:
                fallback += 1
        kinds = sorted(set(verbs)) if verbs else [KIND_EDGE.get(relation_kind, "ACTS_ON")]
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

    print(f"  {len(e_dt)} source rows -> {len(grouped)} relationship types")
    if fallback:
        print(f"  {fallback} verb(s) fell back to the kind edge")

    total = 0
    for rel_type, rows in sorted(grouped.items()):
        n = build_edges(store, rel_type, rows, args.batch)
        total += n
        print(f"  {rel_type:22} {n}")

    print(f"\ntotal drug->target edges: {total}")
    print("== final graph ==")
    print(json.dumps(store.get_stats(), indent=2, default=str)[:1200])
    store.close()


if __name__ == "__main__":
    main()

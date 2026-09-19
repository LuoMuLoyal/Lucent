"""Add the ATC hierarchy edges to the already-loaded graph.

`load_graph.py` now builds SUBCLASS_OF edges as part of a full load. The graph
currently in AGE was loaded before that existed, and a full reload costs ~31
minutes, so the missing edges are added in place.

Idempotent: existing SUBCLASS_OF edges are deleted first.

    uv run python scripts/add_atc_hierarchy.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from semantica.graph_store.age_store import ApacheAgeStore

from semantica_service.config import get_settings

DATA = Path(__file__).resolve().parent.parent / "data"


def cypher_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        inner = ", ".join(f"{k}: {cypher_value(v)}" for k, v in value.items())
        return "{" + inner + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(cypher_value(v) for v in value) + "]"
    return json.dumps(str(value), ensure_ascii=False)


def cypher_list(rows: list[dict[str, Any]]) -> str:
    return (
        "["
        + ", ".join(
            "{" + ", ".join(f"{k}: {cypher_value(v)}" for k, v in r.items()) + "}" for r in rows
        )
        + "]"
    )


def atc_parent(code: str) -> str | None:
    """Return the parent ATC code, or ``None`` at the top of the hierarchy.

    ATC levels are not a uniform one-character step: the chemical-substance
    level is 7 characters (``N06AB05``) and its parent, the chemical subgroup,
    is 5 (``N06AB``) — so the step is 2 there and 1 everywhere else. Stripping
    a single character would leave every level-7 node unattached, which is
    exactly the bug this replaces.
    """
    if len(code) == 7:
        return code[:5]
    if len(code) > 1:
        return code[:-1]
    return None


def main() -> None:
    settings = get_settings()
    store = ApacheAgeStore(connection_string=settings.age_dsn, graph_name=settings.graph_name)
    store.connect()

    with (DATA / "atc_nodes.jsonl").open(encoding="utf-8") as handle:
        atc = [json.loads(line) for line in handle if line.strip()]
    codes = {a["code"] for a in atc}

    pairs = [
        {"source": parent, "target": code, "props": {}}
        for code in sorted(codes)
        if (parent := atc_parent(code)) and parent in codes
    ]
    print(f"ATC codes: {len(codes)}  parent->child pairs: {len(pairs)}")

    # Idempotent: drop any existing hierarchy edges before re-adding.
    store.execute_query("MATCH ()-[r:SUBCLASS_OF]->() DELETE r")
    print("cleared existing SUBCLASS_OF edges")

    batch = 1000
    total = 0
    for start in range(0, len(pairs), batch):
        chunk = pairs[start : start + batch]
        query = (
            f"UNWIND {cypher_list(chunk)} AS row "
            f"MATCH (a:ATCClass {{code: row.source}}) "
            f"MATCH (b:ATCClass {{code: row.target}}) "
            f"CREATE (a)-[:SUBCLASS_OF]->(b) "
            f"RETURN count(*) AS created"
        )
        result = store.execute_query(query)
        if not result.get("success"):
            raise RuntimeError(f"failed: {result.get('error')}")
        total += int(result["records"][0]["created"])
        print(f"  {total}/{len(pairs)}", end="\r", flush=True)
    print()

    print("\n== verify: drugs reachable from N06A ==")
    # Built as a single anchored pattern (one start node, then repeated hops)
    # rather than a concatenation of separate arrow segments.
    for depth in (1, 2, 3):
        hops = "-[:SUBCLASS_OF]->(n1:ATCClass)" + "".join(
            f"-[:SUBCLASS_OF]->(n{i}:ATCClass)" for i in range(2, depth + 1)
        )
        leaf = "n1" if depth == 1 else f"n{depth}"
        res = store.execute_query(
            f"MATCH (a:ATCClass {{code: 'N06A'}}){hops}<-[:IN_ATC_CLASS]-(d:Drug) "
            f"RETURN count(DISTINCT d) AS n"
        )
        n = res["records"][0]["n"] if res.get("success") else res.get("error")
        print(f"  depth {depth} (via {leaf}): {n} drugs")

    stats = store.get_stats()
    print("\nrelationship_count:", stats.get("relationship_count"))
    store.close()


if __name__ == "__main__":
    main()

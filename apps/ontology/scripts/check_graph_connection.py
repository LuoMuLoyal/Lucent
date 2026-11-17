"""Connectivity check: the graph store against a real Neo4j.

Run against the dev stack:

    uv run python scripts/check_graph_connection.py

Connection settings come from the same environment the service reads, so this
exercises the real configuration path rather than a URI copied into the script.

Not part of the test suite — the suite must run without a database.
"""

from semantica_service.config import get_settings
from semantica_service.graph.pool import StorePool


def main() -> None:
    settings = get_settings()

    pool = StorePool(settings)
    with pool.borrow() as store:
        print(f"connected: {settings.neo4j_uri} database={settings.neo4j_database}")
        print("stats:", store.get_stats())

        # Read-only round-trips over the existing graph: this script must not
        # mutate whatever data the target database holds.
        print("sample nodes:", store.execute_query("MATCH (n) RETURN n LIMIT 5", {}))

        # Labels and relationship types the queries rely on. Printing them is how
        # a caller notices that a load half-finished: the vocabulary is exactly
        # what the prompt block and /schema are built from.
        labels = store.execute_query(
            "CALL db.labels() YIELD label RETURN label ORDER BY label", {}
        )
        print("labels:", [row["label"] for row in labels["records"]])
        types = store.execute_query(
            "CALL db.relationshipTypes() YIELD relationshipType AS t RETURN t ORDER BY t", {}
        )
        print("relationship types:", [row["t"] for row in types["records"]])

        # The construct AGE could not parse is the one worth confirming here: if
        # this returns rows, the migration's whole point is in effect. The
        # endpoints are read from the graph rather than hardcoded — this loads a
        # bounded subgraph, so a pair that happens to be absent would make the
        # check pass by returning nothing.
        pair = store.execute_query(
            "MATCH (a:Drug)-[:INTERACTS_WITH]-(b:Drug) "
            "RETURN a.drugbank_id AS a, b.drugbank_id AS b LIMIT 1",
            {},
        )
        if not pair["records"]:
            print("shortestPath hops: skipped (no INTERACTS_WITH edge in the graph)")
        else:
            ends = pair["records"][0]
            paths = store.execute_query(
                "MATCH p = shortestPath((a:Drug)-[*..6]-(b:Drug)) "
                "WHERE a.drugbank_id = $a AND b.drugbank_id = $b RETURN length(p) AS hops",
                {"a": ends["a"], "b": ends["b"]},
            )
            print(f"shortestPath hops ({ends['a']} -> {ends['b']}):", paths["records"])


if __name__ == "__main__":
    main()

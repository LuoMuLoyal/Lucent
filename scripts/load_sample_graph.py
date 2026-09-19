"""Load a small DrugBank-shaped sample into AGE's lucent_graph.

The graph is built deterministically from structured fields — no LLM
extraction — so a hand-written fixture is a faithful stand-in for what the real
ingest produces. Deliberately includes one node that violates the sample SHACL
shape, so validation has something to find.

    uv run python scripts/load_sample_graph.py
"""

from semantica.graph_store.age_store import ApacheAgeStore

from semantica_service.config import get_settings

# Drug -> Protein (TARGETS) and Drug -> Drug (INTERACTS_WITH) mirror the
# English-side OAG's actual edge kinds.
NODES = [
    ("Drug", {"drugbank_id": "DB00945", "name": "Aspirin"}),
    ("Drug", {"drugbank_id": "DB00682", "name": "Warfarin"}),
    ("Drug", {"drugbank_id": "DB01050", "name": "Ibuprofen"}),
    ("Protein", {"uniprot_id": "P23219", "name": "COX-1"}),
    ("Protein", {"uniprot_id": "P00734", "name": "Prothrombin"}),
    # No name: the sample shape requires one, so this node is a violation.
    ("Protein", {"uniprot_id": "P99999"}),
]

EDGES = [
    ("Aspirin", "COX-1", "TARGETS", {"affinity": "high"}),
    ("Ibuprofen", "COX-1", "TARGETS", {"affinity": "high"}),
    ("Warfarin", "Prothrombin", "TARGETS", {"affinity": "medium"}),
    ("Aspirin", "Warfarin", "INTERACTS_WITH", {"severity": "major"}),
    ("Ibuprofen", "Warfarin", "INTERACTS_WITH", {"severity": "major"}),
]


def main() -> None:
    settings = get_settings()
    store = ApacheAgeStore(
        connection_string=settings.age_dsn,
        graph_name=settings.graph_name,
    )
    store.connect()

    # AGE's Cypher subset has no multi-label match (`(n:A|B)`), so labels are
    # cleared one at a time. DETACH also drops the edges, leaving the graph
    # empty rather than accumulating duplicates across runs.
    for label in {label for label, _ in NODES}:
        store.execute_query(f"MATCH (n:{label}) DETACH DELETE n")

    # Keyed by the stable external id, since one sample node deliberately has
    # no name.
    ids: dict[str, int | str] = {}
    for label, props in NODES:
        pairs = ", ".join(f"{k}: ${k}" for k in props)
        result = store.execute_query(
            f"CREATE (n:{label} {{{pairs}}}) RETURN id(n) AS id",
            dict(props),
        )
        if not result.get("success"):
            raise RuntimeError(f"node create failed: {result.get('error')}")
        key = props.get("drugbank_id") or props.get("uniprot_id")
        if key is None:
            raise RuntimeError(f"node {props} has no identifying property")
        ids[str(key)] = result["records"][0]["id"]

    # Edges reference nodes by display name, which maps onto the id above.
    name_to_id = {
        str(props.get("name")): ids[str(props.get("drugbank_id") or props.get("uniprot_id"))]
        for _, props in NODES
        if props.get("name")
    }

    for source, target, rel_type, props in EDGES:
        severity = props.get("severity", props.get("affinity", "unknown"))
        result = store.execute_query(
            f"MATCH (a), (b) WHERE id(a) = {name_to_id[source]} "
            f"AND id(b) = {name_to_id[target]} "
            f"CREATE (a)-[r:{rel_type} {{severity: $severity}}]->(b) RETURN r",
            {"severity": severity},
        )
        if not result.get("success"):
            raise RuntimeError(f"edge create failed: {result.get('error')}")

    print("loaded:", store.get_stats())
    store.close()


if __name__ == "__main__":
    main()

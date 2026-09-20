from semantica_service.config import get_settings
from semantica_service.graph import StorePool

s = get_settings()
pool = StorePool(s)
with pool.borrow() as store:
    checks = [
        (
            "warfarin incoming, both endpoints drug keys present",
            "MATCH (a:Drug)-[r:INTERACTS_WITH]->(b:Drug) WHERE b.drugbank_id='DB00682' "
            "AND a.drugbank_id IS NOT NULL RETURN count(r) AS c",
        ),
        (
            "warfarin target-side drugs (the scope we need)",
            "MATCH (a:Drug)-[r:INTERACTS_WITH]->(b:Drug) WHERE b.drugbank_id='DB00682' "
            "RETURN DISTINCT a.drugbank_id AS id LIMIT 5",
        ),
        (
            "warfarin protein neighbours",
            "MATCH (a:Drug)-[r:ACTS_ON]->(b:Protein) WHERE a.drugbank_id='DB00682' "
            "RETURN count(r) AS c",
        ),
        (
            "warfarin enzyme neighbours",
            "MATCH (a:Drug)-[r:SUBSTRATE_OF]->(b:Protein) WHERE a.drugbank_id='DB00682' "
            "RETURN count(r) AS c",
        ),
    ]
    for label, q in checks:
        print(label, "->", store.execute_query(q)["records"])
pool.close()

"""End-to-end check: the fork's AGE store against the real AGE container.

Not part of the test suite — the suite must run without a database. This is the
manual verification used to confirm the image and the adapter agree.
"""

from semantica.graph_store.age_store import ApacheAgeStore

DSN = "host=127.0.0.1 port=15433 dbname=lucent_graph user=postgres password=postgres"

store = ApacheAgeStore(connection_string=DSN, graph_name="lucent_graph")
store.connect()
print("connect() + CREATE EXTENSION + SET search_path: OK")
print("stats:", store.get_stats())

rows = store.execute_query("MATCH (n:Drug) RETURN n.name AS name")
print("cypher round-trip:", rows)

# The fork fix: RETURN column inference must survive a backtick alias and
# ORDER BY without mistaking either for a column.
rows2 = store.execute_query("MATCH (n:Drug) RETURN n.name AS `drug name` ORDER BY n.name")
print("order-by + backtick alias:", rows2)

store.close()

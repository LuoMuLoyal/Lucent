"""Connectivity check: the fork's AGE store against a real AGE database.

Run against the dev stack:

    uv run python scripts/check_age_connection.py

Connection settings come from the same environment the service reads, so this
exercises the real configuration path rather than a DSN copied into the script.

Not part of the test suite — the suite must run without a database.
"""

from semantica.graph_store.age_store import ApacheAgeStore

from semantica_service.config import get_settings


def main() -> None:
    settings = get_settings()

    store = ApacheAgeStore(
        connection_string=settings.age_dsn,
        graph_name=settings.graph_name,
    )
    store.connect()
    print(f"connected: graph={settings.graph_name}")
    print("stats:", store.get_stats())

    # A round-trip over the existing graph. Read-only: this script must not
    # mutate whatever data the target database holds.
    rows = store.execute_query("MATCH (n) RETURN n LIMIT 5")
    print("sample nodes:", rows)

    # The fork fix: RETURN column inference must survive a backtick alias and
    # ORDER BY without mistaking either for a column.
    rows2 = store.execute_query("MATCH (n) RETURN n.name AS `n name` ORDER BY n.name LIMIT 5")
    print("backtick alias + order by:", rows2)

    store.close()


if __name__ == "__main__":
    main()

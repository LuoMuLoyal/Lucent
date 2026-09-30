"""Service configuration.

All settings come from the environment so the same image can run against any
Neo4j database. Defaults target the local development stack; nothing here
carries a credential.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the Semantica service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Neo4j ----------------------------------------------------------
    # Bolt rather than the HTTP interface: the driver speaks it natively and
    # unlike Apache AGE, Neo4j is its own server, so there is no database to
    # share with the Prisma schema and no search_path to override. Port 7687
    # is Bolt; 7474 is the browser UI and is not used by this service.
    neo4j_uri: str = Field(
        default="bolt://127.0.0.1:7687",
        description="Bolt URI of the Neo4j server.",
    )
    neo4j_user: str = Field(default="neo4j", description="Neo4j user.")
    neo4j_password: str = Field(
        default="",
        description="Neo4j password. Empty means 'not configured', which fails loudly.",
    )
    neo4j_database: str = Field(
        default="neo4j",
        description="Neo4j database to query.",
    )

    # --- Connection pool ------------------------------------------------
    # A single shared store serialises concurrent requests (measured 2.9x
    # slower at 16 concurrent callers), so requests borrow from a pool.
    #
    # Neo4j's driver carries its own pool, but sessions are *not* thread-safe,
    # so the service still hands each request its own session; these bounds
    # size that pool and must match the driver's own connection ceiling.
    pool_min_size: int = Field(default=1, ge=1)
    pool_max_size: int = Field(default=10, ge=1)

    # --- Provenance -----------------------------------------------------
    # The audit trail lives in Postgres rather than a file so it survives with
    # the data it describes, and in Lucent's database rather than the graph's:
    # the graph exists only to hold the graph, and audit rows are not graph
    # data. Together with Lucent's own `audit_logs`, one SQL connection can
    # read both. This store is independent of the graph backend, so the
    # AGE -> Neo4j migration does not touch it.
    provenance_dsn: str = Field(
        default=("host=127.0.0.1 port=15432 dbname=lucent user=postgres password=postgres"),
        description="libpq connection string for the provenance store.",
    )
    provenance_table: str = Field(
        default="semantica_provenance",
        description="Table holding the hash-chained provenance entries.",
    )
    # Read-only, and used by the import and verification scripts only: the
    # service never reads the DrugBank source tables at request time.
    source_dsn: str = Field(
        default=("host=127.0.0.1 port=15432 dbname=lucent user=postgres password=postgres"),
        description="libpq connection string for Lucent's DrugBank source tables.",
    )

    # --- Query safety ---------------------------------------------------
    # A runaway variable-length path once ran for two minutes and had to be
    # killed with pg_terminate_backend. Every transaction sets a ceiling.
    #
    # Neo4j has no per-connection statement_timeout, so this is applied per
    # transaction instead (`session.run(..., timeout=...)`), which is stricter:
    # the bound travels with the call rather than with the connection.
    statement_timeout_ms: int = Field(default=15_000, ge=0)
    connect_timeout_s: int = Field(default=10, ge=1)

    # --- Reasoning ------------------------------------------------------
    # Datalog fixpoint and SHACL validation are CPU-bound and synchronous;
    # an unbounded input can pin a worker indefinitely.
    max_reasoning_facts: int = Field(default=50_000, ge=1)
    reasoning_timeout_s: int = Field(default=30, ge=1)
    # `rules/*.yaml` shipped with the service. Overridable so a deployment can
    # mount a reviewed rule set without rebuilding the image.
    rules_dir: str = Field(
        default="",
        description="Directory holding the versioned rule library; empty uses the shipped set.",
    )

    # --- Observability --------------------------------------------------
    # JSON by default: the service's useful output is quantitative (how many
    # edges a scope loaded, whether it was truncated, how many facts the
    # fixpoint produced), and those values are only queryable as fields.
    # `text` renders the same fields for a human reading a terminal.
    log_level: str = Field(default="INFO", description="Root log level.")
    log_format: str = Field(
        default="json",
        description="'json' for one object per line, 'text' for a readable line.",
    )


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()

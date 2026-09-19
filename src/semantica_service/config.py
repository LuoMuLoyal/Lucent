"""Service configuration.

All settings come from the environment so the same image can run against any
AGE database. Defaults target the local development stack; nothing here
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

    # --- Apache AGE -----------------------------------------------------
    # AGE lives in its own database rather than the Prisma schema's, because
    # the adapter issues SET search_path = ag_catalog for every session.
    # Port 15432 matches the dev stack's postgres-dev (see Lucent's
    # compose.dev.yaml); production supplies AGE_DSN explicitly.
    age_dsn: str = Field(
        default="host=127.0.0.1 port=15432 dbname=lucent_graph user=postgres password=postgres",
        description="libpq connection string for the AGE database.",
    )
    graph_name: str = Field(
        default="lucent_graph",
        description="AGE graph to query.",
    )

    # --- Connection pool ------------------------------------------------
    # A single shared store serialises concurrent requests (measured 2.9x
    # slower at 16 concurrent callers), so requests borrow from a pool.
    pool_min_size: int = Field(default=1, ge=1)
    pool_max_size: int = Field(default=10, ge=1)

    # --- Query safety ---------------------------------------------------
    # A runaway variable-length path once ran for two minutes and had to be
    # killed with pg_terminate_backend. Every connection sets a ceiling.
    statement_timeout_ms: int = Field(default=15_000, ge=0)
    connect_timeout_s: int = Field(default=10, ge=1)

    # --- Reasoning ------------------------------------------------------
    # Datalog fixpoint and SHACL validation are CPU-bound and synchronous;
    # an unbounded input can pin a worker indefinitely.
    max_reasoning_facts: int = Field(default=50_000, ge=1)
    reasoning_timeout_s: int = Field(default=30, ge=1)


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()

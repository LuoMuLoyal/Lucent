"""Application composition: settings, connection pool and routers.

Every handler in this service is a synchronous ``def``. The underlying work —
the Neo4j driver, pyshacl validation — is blocking, and FastAPI runs synchronous
handlers in a thread pool. Declaring them ``async def`` would place that work on
the event loop and stall every other request while it runs.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings
from .graph import StorePool
from .logging_setup import configure_logging, log_event
from .provenance import ProvenanceReader
from .reasoning import RuleLibrary, load_library, verify_against_vocabulary
from .routes import health, provenance, query, reason, resolve, schema, validate

logger = logging.getLogger("semantica_service")

__version__ = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open the Neo4j pool for the process lifetime.

    The pool holds connections, so it is created once per process rather than
    per request; ``close()`` returns them on shutdown. The provenance reader is
    constructed here but stays lazy: a deployment whose provenance store has not
    been migrated yet must still start and still answer queries, reporting
    citations as unavailable rather than refusing to serve.

    The rule library is checked against the graph's vocabulary here, and a
    failure stops startup. The alternative is worse than a crash: a rule that
    consumes a relationship type the graph does not have simply never fires, so
    the service would answer every request with a confident "nothing follows"
    that is indistinguishable from a real negative finding.
    """
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    pool = StorePool(settings)
    app.state.pool = pool
    app.state.settings = settings
    app.state.provenance = ProvenanceReader(settings)
    app.state.rules = _check_rules(pool)
    log_event(
        logger,
        "service_started",
        graph=settings.neo4j_database,
        rules=len(app.state.rules.rules),
        pool_max_size=settings.pool_max_size,
    )
    try:
        yield
    finally:
        app.state.provenance.close()
        pool.close()
        log_event(logger, "service_stopped")


def _check_rules(pool: StorePool) -> RuleLibrary:
    """Return the rule library, verified against the live vocabulary.

    A graph that cannot be read is *not* a reason to refuse startup: the service
    still answers ``/health`` with 503, which is how a load balancer is told to
    stop routing to it. The vocabulary check is therefore skipped when the graph
    is unreachable, and reported through health instead of by crashing.
    """
    library = load_library()
    try:
        with pool.borrow() as store:
            stats = store.get_stats()
    except Exception:  # noqa: BLE001 - unreachable graph is reported by /health
        return library

    counts = stats.get("relationship_type_counts") or {}
    verify_against_vocabulary(library, set(counts))
    return library


def create_app() -> FastAPI:
    """Build the FastAPI application."""
    app = FastAPI(
        title="Semantica Service",
        description="Ontology-grounded reasoning over the English DrugBank graph.",
        version=__version__,
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(schema.router)
    app.include_router(validate.router)
    app.include_router(reason.router)
    app.include_router(resolve.router)
    app.include_router(query.router)
    app.include_router(provenance.router)
    return app


app = create_app()

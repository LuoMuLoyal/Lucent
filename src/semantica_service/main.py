"""Application composition: settings, connection pool and routers.

Every handler in this service is a synchronous ``def``. The underlying work —
``psycopg2`` against Apache AGE, the Datalog fixpoint, pyshacl validation — is
blocking or CPU-bound, and FastAPI runs synchronous handlers in a thread pool.
Declaring them ``async def`` would place that work on the event loop and stall
every other request while it runs.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings
from .graph import StorePool
from .provenance import ProvenanceReader
from .routes import health, provenance, query, reason, resolve, schema, validate

__version__ = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open the AGE pool for the process lifetime.

    The pool holds connections, so it is created once per process rather than
    per request; ``close()`` returns them on shutdown. The provenance reader is
    constructed here but stays lazy: a deployment whose provenance store has not
    been migrated yet must still start and still answer queries, reporting
    citations as unavailable rather than refusing to serve.
    """
    settings = get_settings()
    pool = StorePool(settings)
    app.state.pool = pool
    app.state.settings = settings
    app.state.provenance = ProvenanceReader(settings)
    try:
        yield
    finally:
        app.state.provenance.close()
        pool.close()


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

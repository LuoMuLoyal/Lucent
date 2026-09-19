"""Health endpoint.

Reports whether the service can actually reach its graph. A liveness probe
that only proves the process is running would report healthy while every
reasoning call fails, so this one borrows a real connection and reads the
graph's node and edge counts.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..graph import StorePool

router = APIRouter(tags=["health"])


def _graph_stats(pool: StorePool) -> dict[str, Any]:
    """Read node and edge counts from the AGE graph."""
    with pool.borrow() as store:
        stats: dict[str, Any] = store.get_stats()
        return stats


@router.get("/health")
def health(request: Request) -> JSONResponse:
    """Liveness plus AGE reachability and graph size.

    Returns 503 when the graph cannot be reached, so a load balancer stops
    routing to a process whose dependency is down.
    """
    pool: StorePool = request.app.state.pool
    settings = request.app.state.settings
    try:
        stats = _graph_stats(pool)
    except Exception as exc:  # noqa: BLE001 - a probe must report any failure
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "graph": settings.graph_name,
                "error": f"{type(exc).__name__}: {exc}",
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "graph": settings.graph_name,
            "pool": {"size": pool.size, "idle": pool.idle_count},
            "stats": stats,
        },
    )

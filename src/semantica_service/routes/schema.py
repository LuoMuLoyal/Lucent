"""GET /schema — the graph's shape.

Answers "what is in the graph" without exposing Cypher: which node labels and
relationship types exist, and how many of each. This is what a caller needs
before writing a query or a SHACL shape.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..graph import StorePool
from .schemas import LabelCount, SchemaResponse

router = APIRouter(tags=["schema"])


@router.get("/schema", response_model=SchemaResponse)
def get_schema(request: Request) -> JSONResponse:
    """Return node labels, relationship types and their counts.

    ``get_stats()`` already aggregates these in one round-trip, so this does
    not scan the graph per label.
    """
    pool: StorePool = request.app.state.pool
    settings = request.app.state.settings

    with pool.borrow() as store:
        stats = store.get_stats()

    labels = [
        LabelCount(label=str(name), count=int(count))
        for name, count in (stats.get("label_counts") or {}).items()
    ]
    rel_types = [
        LabelCount(label=str(name), count=int(count))
        for name, count in (stats.get("relationship_type_counts") or {}).items()
    ]
    # Stable ordering: a schema response that reshuffles between calls is
    # needlessly hard to diff.
    labels.sort(key=lambda item: (-item.count, item.label))
    rel_types.sort(key=lambda item: (-item.count, item.label))

    payload = SchemaResponse(
        graph=settings.graph_name,
        node_count=int(stats.get("node_count", 0)),
        relationship_count=int(stats.get("relationship_count", 0)),
        labels=labels,
        relationship_types=rel_types,
    )
    return JSONResponse(content=payload.model_dump())

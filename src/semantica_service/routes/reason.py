"""POST /reason — Datalog inference over the graph.

Facts come either from the request or from the AGE graph via the export
bridge. The fixpoint is CPU-bound and synchronous, so the handler is a plain
``def``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from semantica.reasoning.datalog_reasoner import DatalogReasoner

from ..graph import GraphExport, StorePool
from .schemas import ReasonRequest, ReasonResponse

router = APIRouter(tags=["reason"])


@router.post("/reason", response_model=ReasonResponse)
def reason(request: Request, body: ReasonRequest) -> JSONResponse:
    """Derive facts from rules and facts.

    With ``load_from_graph`` the graph is exported and used as the initial
    fact set. ``DatalogReasoner.load_from_graph`` rejects an AGE store handle
    outright — it needs a ContextGraph-like object — so the export bridge
    supplies ``find_nodes()`` / ``find_edges()``.
    """
    engine = DatalogReasoner()

    if body.load_from_graph:
        pool: StorePool = request.app.state.pool
        with pool.borrow() as store:
            exported = GraphExport(store, limit=body.limit)
        try:
            engine.load_from_graph(exported)
        except TypeError as exc:
            # The bridge exists precisely to prevent this; if it still fires,
            # the failure is ours and should not look like a client error.
            raise HTTPException(
                status_code=500,
                detail=f"Graph export produced an unusable fact source: {exc}",
            ) from exc

    for fact in body.facts:
        try:
            engine.add_fact(fact.fact)
        except (ValueError, IndexError) as exc:
            # A malformed fact is the caller's mistake, and the message names it.
            raise HTTPException(
                status_code=422,
                detail=f"Invalid fact {fact.fact!r}: {exc}",
            ) from exc

    for rule in body.rules:
        try:
            engine.add_rule(rule.rule)
        except (ValueError, IndexError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid rule {rule.rule!r}: {exc}",
            ) from exc

    # derive_all() returns every fact in the base, not only the inferred ones,
    # so it covers both the rules and no-rules cases. With no facts at all it
    # returns an empty list, which is indistinguishable from "nothing derived"
    # and worth reporting explicitly.
    derived = engine.derive_all()
    if not derived:
        raise HTTPException(
            status_code=422,
            detail="No facts to reason over. Supply 'facts' or set 'load_from_graph'.",
        )

    bindings = None
    if body.query:
        try:
            bindings = engine.query(body.query)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid query {body.query!r}: {exc}",
            ) from exc
        bindings = [{str(k): str(v) for k, v in row.items()} for row in bindings]

    payload = ReasonResponse(
        fact_count=len(derived),
        derived=sorted(derived),
        bindings=bindings,
    )
    return JSONResponse(content=payload.model_dump())

"""POST /resolve — name to graph-term lookup.

A caller usually has a drug name, not a DrugBank identifier, and the graph
keys everything by identifier. Names are not unique in the graph (target names
repeat across species and strains), so this reports every match rather than
silently choosing one — an ambiguous lookup that looks confident is worse than
one that admits it.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..graph import GraphExport, StorePool
from .schemas import ResolvedTerm, ResolveRequest, ResolveResponse

router = APIRouter(tags=["resolve"])


@router.post("/resolve", response_model=ResolveResponse)
def resolve(request: Request, body: ResolveRequest) -> JSONResponse:
    """Return every graph term whose name matches, case-insensitively.

    Scans the exported graph rather than querying AGE by property, because AGE
    has no index on these properties and an exact-match Cypher scan costs a
    full label traversal anyway; reusing the export bridge keeps one code path
    for how keys are derived.
    """
    pool: StorePool = request.app.state.pool
    with pool.borrow() as store:
        exported = GraphExport(store, limit=body.limit * 400)

    wanted = body.name.strip().casefold()
    if not wanted:
        raise HTTPException(status_code=422, detail="name must not be blank")

    matches: list[ResolvedTerm] = []
    for node in exported.find_nodes():
        props = node.get("properties") or {}
        candidates = [
            props.get("name"),
            props.get("uniprot_title"),
            props.get("gene_name"),
        ]
        # Match on any alias field so a caller can pass a gene name.
        if not any(str(c).strip().casefold() == wanted for c in candidates if c not in (None, "")):
            continue
        matches.append(
            ResolvedTerm(
                key=str(node["id"]),
                name=str(props.get("name") or props.get("uniprot_title") or node["id"]),
                type=str(node["type"]),
                properties=props,
            )
        )
        if len(matches) >= body.limit:
            break

    payload = ResolveResponse(
        name=body.name,
        match_count=len(matches),
        matches=matches,
        ambiguous=len(matches) > 1,
    )
    return JSONResponse(content=payload.model_dump())

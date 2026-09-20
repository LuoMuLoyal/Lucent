"""POST /validate — SHACL validation of the graph.

The graph is exported from AGE as Turtle, then validated against shapes given
either inline or derived from an ontology. pyshacl is CPU-bound and
synchronous, so this handler is a plain ``def`` and runs in FastAPI's
threadpool.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from semantica.ontology.engine import OntologyEngine

from ..graph import GRAPH_NAMESPACE, GRAPH_PREFIX, GraphExport, StorePool
from ..graph.shapes import check_shape_namespaces
from .schemas import ValidateRequest, ValidateResponse, Violation

router = APIRouter(tags=["validate"])


def _to_violation(raw: Any) -> Violation:
    """Map one semantica violation onto the response model.

    semantica's violation objects are dataclasses whose field names vary by
    constraint component, so this reads defensively rather than assuming a
    fixed schema.
    """

    def get(name: str) -> Any:
        """Read a field from a dict or an object, whichever came back."""
        if isinstance(raw, dict):
            return raw.get(name)
        return getattr(raw, name, None)

    def text(name: str) -> str | None:
        value: Any = get(name)
        return None if value is None else str(value)

    return Violation(
        focus_node=text("focus_node"),
        path=text("path"),
        message=text("message"),
        component=text("component") or text("constraint_component"),
        severity=text("severity"),
        explanation=text("explanation"),
        value=text("value"),
    )


@router.post("/validate", response_model=ValidateResponse)
def validate(request: Request, body: ValidateRequest) -> JSONResponse:
    """Validate the AGE graph against SHACL shapes.

    Exactly one of ``shacl`` / ``ontology`` must be supplied — semantica raises
    when given both or neither, and rejecting it here yields a clear 422
    instead of a 500 from inside the engine.

    Shapes whose terms do not resolve into the graph's namespace are refused
    rather than run. SHACL reports "conforms" for a shape that selects no
    targets, so running them would return a clean report from a check that
    never happened — and a false pass is worse than an error, because the
    caller acts on it.
    """
    if (body.shacl is None) == (body.ontology is None):
        raise HTTPException(
            status_code=422,
            detail="Supply exactly one of 'shacl' or 'ontology', not both or neither.",
        )

    if body.shacl is not None:
        report = check_shape_namespaces(body.shacl)
        if not report.ok:
            raise HTTPException(
                status_code=422,
                detail=(
                    "The shapes cannot constrain this graph: "
                    + " ".join(report.problems)
                    + f" The export uses @prefix {GRAPH_PREFIX}: <{GRAPH_NAMESPACE}> ."
                ),
            )

    pool: StorePool = request.app.state.pool
    settings = request.app.state.settings

    with pool.borrow() as store:
        exported = GraphExport(store, limit=body.limit)

    if exported.node_count == 0:
        # Validating an empty graph would report "conforms", which is
        # misleading rather than usefully true.
        raise HTTPException(
            status_code=422,
            detail=(
                f"Graph '{settings.graph_name}' has no nodes to validate (limit={body.limit})."
            ),
        )

    engine = OntologyEngine()
    kwargs: dict[str, Any] = {"explain": body.explain}
    if body.ontology is not None:
        kwargs["ontology"] = body.ontology
    else:
        kwargs["shacl"] = body.shacl

    report = engine.validate_graph(exported.to_turtle(), **kwargs)

    violations = [_to_violation(v) for v in getattr(report, "violations", [])]
    warnings = [_to_violation(w) for w in getattr(report, "warnings", [])]

    payload = ValidateResponse(
        conforms=bool(report.conforms),
        summary=report.summary(),
        violation_count=len(violations),
        warning_count=len(warnings),
        violations=violations,
        warnings=warnings,
        shacl_source="inline" if body.shacl is not None else "ontology",
    )
    return JSONResponse(content=payload.model_dump())

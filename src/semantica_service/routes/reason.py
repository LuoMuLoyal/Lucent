"""POST /reason — Datalog inference over the graph.

Facts come either from the request or from the AGE graph via the export
bridge. The fixpoint is CPU-bound and synchronous, so the handler is a plain
``def``.

Graph-backed inference is **scoped**: the caller names drugs or ATC prefixes,
the scope is resolved into graph keys, and the response echoes what was
actually loaded. Datalog has no negation, so "not derived" is the only answer
available for "not present", and that answer carries no information unless the
input's extent is known. Loading a random slice would therefore manufacture
false negatives that read like findings.
"""

from __future__ import annotations

import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from semantica.reasoning.datalog_reasoner import DatalogReasoner

from ..graph import GraphExport, ScopeSpec, StorePool, resolve_scope
from ..reasoning_limits import (
    KIND_TIMEOUT,
    FactBudget,
    check_declared_sizes,
    reject,
)
from .schemas import ReasonRange, ReasonRequest, ReasonResponse

router = APIRouter(tags=["reason"])


def _derive_with_deadline(engine: DatalogReasoner, timeout_s: int) -> list[str] | None:
    """Run the fixpoint under a wall-clock ceiling.

    Datalog is CPU-bound and semi-naive, so a pathological rule/data pair spins
    inside ``derive_all`` without ever yielding. The call therefore runs on a
    worker thread the caller can abandon: on timeout the deadline returns
    ``None`` and the request is refused, rather than the worker holding a
    threadpool slot until the process runs out of them.

    The abandoned thread cannot be killed — Python offers no way to interrupt
    a running frame — so it finishes on its own. That is a real cost and the
    reason the ceiling exists: the alternative is not "no cost", it is an
    unbounded number of such threads.
    """
    result: list[str] = []
    failure: list[BaseException] = []

    def run() -> None:
        try:
            result.extend(engine.derive_all())
        except BaseException as exc:  # noqa: BLE001 - re-raised in the caller
            failure.append(exc)

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(timeout=timeout_s)

    if worker.is_alive():
        return None
    if failure:
        raise failure[0]
    return result


def _load_graph(request: Request, body: ReasonRequest) -> GraphExport:
    """Export the graph the request asked for, or explain why it cannot.

    A graph-backed request without a scope is refused rather than defaulted to
    the whole graph: silently reasoning over everything is the same
    unbounded-input mistake as silently reasoning over a slice, and the caller
    that wants the whole graph can say so with ``scope_all``.
    """
    pool: StorePool = request.app.state.pool

    if body.scope is None and not body.scope_all:
        raise HTTPException(
            status_code=422,
            detail=(
                "Graph-backed reasoning requires a scope: supply 'scope' with "
                "drug_names and/or atc_prefixes, or set 'scope_all' to load the "
                "entire graph. Reasoning over a truncated graph cannot distinguish "
                "'not derived' from 'not present'."
            ),
        )

    with pool.borrow() as store:
        if body.scope is None:
            return GraphExport(store, limit=body.limit, scope_label="all")

        resolved = resolve_scope(
            store,
            ScopeSpec(
                drug_names=tuple(body.scope.drug_names),
                atc_prefixes=tuple(body.scope.atc_prefixes),
                limit=body.limit,
            ),
        )
        if resolved.is_empty:
            # An empty scope is not a small scope; it is a scope that matched
            # nothing, and reporting "no derivations" for it would be a
            # statement about a graph nobody asked about.
            raise HTTPException(
                status_code=422,
                detail=(
                    "Scope matched nothing in the graph: "
                    f"drug_names={list(body.scope.drug_names)!r}, "
                    f"atc_prefixes={list(body.scope.atc_prefixes)!r}."
                ),
            )
        return GraphExport(
            store,
            limit=body.limit,
            drug_keys=resolved.drug_keys,
            atc_keys=resolved.atc_keys,
            seed_drug_keys=resolved.seed_drug_keys,
            scope_label="explicit",
        )


@router.post("/reason", response_model=ReasonResponse)
def reason(request: Request, body: ReasonRequest) -> JSONResponse:
    """Derive facts from rules and facts.

    With ``load_from_graph`` the scoped graph is exported and used as the
    initial fact set. ``DatalogReasoner.load_from_graph`` rejects an AGE store
    handle outright — it needs a ContextGraph-like object — so the export
    bridge supplies ``find_nodes()`` / ``find_edges()``.
    """
    engine = DatalogReasoner()
    labels: dict[str, str] = {}
    node_types: dict[str, str] = {}
    reason_range: ReasonRange | None = None
    fact_assertions: dict[str, str | None] = {}

    settings = request.app.state.settings
    check_declared_sizes(body)

    if body.load_from_graph:
        exported = _load_graph(request, body)
        labels = exported.labels()
        node_types = exported.node_types()
        fact_assertions = exported.fact_assertions()
        reason_range = ReasonRange(**exported.range.describe())
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

    # The fixpoint runs under a wall-clock ceiling because it is CPU-bound and
    # synchronous: an unbounded derivation does not make one request slow, it
    # holds a threadpool worker until the process runs out of them. The ceiling
    # is enforced on a worker thread so the signal can fire mid-fixpoint rather
    # than only being noticed once the work has already finished.
    budget = FactBudget(settings.max_reasoning_facts)
    derived = _derive_with_deadline(engine, settings.reasoning_timeout_s)
    if derived is None:
        reject(
            KIND_TIMEOUT,
            422,
            (
                f"Reasoning exceeded {settings.reasoning_timeout_s}s "
                "(REASONING_TIMEOUT_S). Narrow the scope or raise the ceiling."
            ),
            timeout_s=settings.reasoning_timeout_s,
        )
    budget.check(len(derived), source="rules over the loaded fact base")

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
        labels=labels,
        node_types=node_types,
        range=reason_range,
        fact_assertions=fact_assertions,
    )
    return JSONResponse(content=payload.model_dump())

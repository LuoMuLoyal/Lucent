"""POST /reason — rule-based inference over the graph.

Each rule is a reviewed Cypher query (``reasoning/cypher_rules.py``). The
database evaluates the join and returns the conclusion's arguments *together
with* the provenance ids of the edges that entailed it, so attribution is a
property of the query rather than a second pass that has to reconstruct it.

Three things changed with the move off Datalog, and each is a deliberate trade
rather than an oversight:

* **The rule library is code, not YAML.** A rule used to be editable without a
  release; now it is a module. What that buys is the join running in the
  database, where the two-hop pattern is planned and indexed, instead of an
  external engine enumerating a materialised fact base.
* **Request-supplied rules are gone.** ``ReasonRequest.rules`` was a handle onto
  a general Datalog evaluator. There is no such evaluator any more, so the field
  was removed rather than accepted-and-ignored: a field that silently does
  nothing is worse than one that is absent, because the caller gets a confident
  answer to a question it did not ask.
* **``facts`` is gone for the same reason.** The rule joins read the graph;
  there is no fact base to preload them with.

Graph-backed inference stays **scoped**, and the scope is still resolved to real
graph keys and echoed back: an unscoped derivation reports "not derived" with no
indication of what it looked at, which reads like a finding.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..graph import ScopeSpec, StorePool, resolve_scope
from ..reasoning.cypher_rules import (
    CypherRule,
    RuleLibrary,
    build_query,
    verify_against_vocabulary,
)
from ..reasoning_limits import (
    KIND_SCOPE_EMPTY,
    KIND_TIMEOUT,
    FactBudget,
    check_declared_sizes,
    reject,
)
from .schemas import (
    DerivedConclusion,
    DerivedRuleInfo,
    ReasonRange,
    ReasonRequest,
    ReasonResponse,
    RuleLibraryResponse,
)

router = APIRouter(tags=["reason"])

_logger = logging.getLogger("semantica_service.reason")


def _resolve_rule(request: Request, body: ReasonRequest) -> CypherRule | None:
    """Look up the rule the request named, or refuse it.

    Naming a rule rather than sending its text is what keeps a conclusion
    attributable: the rule was reviewed in this repository, and the response can
    cite its id.
    """
    if body.intent is None and body.rule_id is None:
        return None
    if body.intent is not None and body.rule_id is not None:
        raise HTTPException(
            status_code=422,
            detail="Supply at most one of 'intent' or 'rule_id'.",
        )

    library: RuleLibrary = request.app.state.rules
    rule = (
        library.by_id(body.rule_id)
        if body.rule_id is not None
        else library.by_intent(str(body.intent))
    )
    if rule is None:
        # The list names the namespace the caller actually used: an error
        # listing rule ids would name values a caller has no way to supply.
        if body.rule_id is not None:
            named, available = body.rule_id, ", ".join(sorted(library.rules)) or "none"
        else:
            named, available = str(body.intent), ", ".join(library.intents()) or "none"
        raise HTTPException(
            status_code=422,
            detail=(
                f"No rule named {named!r} in the library. "
                f"Registered: {available}. "
                "Unregistered rules cannot be called: a conclusion must be "
                "attributable to a reviewed rule."
            ),
        )
    return rule


def _scope_keys(
    request: Request, body: ReasonRequest
) -> tuple[list[str], ReasonRange | None]:
    """Resolve the request's scope to drug keys, and describe what it covers.

    Returns ``([], range)`` for ``scope_all`` and ``(keys, range)`` for a named
    scope. A named scope that matched nothing is refused rather than treated as a
    small scope: reporting "no derivations" for it would be a statement about a
    graph nobody asked about, and that is the refusal a caller is most likely to
    misread as an answer.

    Both branches return a :class:`ReasonRange`, including ``scope_all``. The
    extent is what makes an empty derivation readable — "no conclusion follows"
    means one thing over 900 drugs and another over 3 — so it is reported for
    every graph-backed run rather than only for the scoped ones.
    """
    pool: StorePool = request.app.state.pool

    if body.scope is None:
        if not body.scope_all:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Graph-backed reasoning requires a scope: supply 'scope' with "
                    "drug_names and/or atc_prefixes, or set 'scope_all' to evaluate "
                    "the rule over the entire graph. Reasoning over an unstated extent "
                    "cannot distinguish 'not derived' from 'not looked at'."
                ),
            )
        with pool.borrow() as store:
            stats = store.get_stats()
        return [], ReasonRange(
            scope="all",
            drug_count=int((stats.get("label_counts") or {}).get("Drug", 0)),
            node_count=int(stats.get("node_count", 0)),
            edge_count=int(stats.get("relationship_count", 0)),
            limit=body.limit,
        )

    with pool.borrow() as store:
        resolved = resolve_scope(
            store,
            ScopeSpec(
                drug_names=tuple(body.scope.drug_names),
                atc_prefixes=tuple(body.scope.atc_prefixes),
                limit=body.limit,
            ),
        )

    if resolved.is_empty:
        # Refused through `reject` so the reason carries a `kind`: an
        # unstructured detail left it indistinguishable from a generic 422 in
        # every client that branches on the code.
        reject(
            KIND_SCOPE_EMPTY,
            422,
            (
                "Scope matched nothing in the graph: "
                f"drug_names={list(body.scope.drug_names)!r}, "
                f"atc_prefixes={list(body.scope.atc_prefixes)!r}."
            ),
            drug_names=list(body.scope.drug_names),
            atc_prefixes=list(body.scope.atc_prefixes),
        )

    # Seeds only — the drugs the caller named. The resolved neighbours are
    # reported in the range (so the caller can see the extent) but are not what
    # the rule is scoped to: scoping on the neighbour set made Warfarin, which
    # has 26 shared-target pairs, return 500 pairs belonging to its partners.
    seeds = list(resolved.seed_drug_keys) or list(resolved.drug_keys)
    return seeds, ReasonRange(
        scope="explicit",
        drug_count=len(resolved.drug_keys),
        atc_count=len(resolved.atc_keys),
        limit=body.limit,
        truncated=resolved.truncated,
        seed_drug_keys=list(resolved.seed_drug_keys),
        drug_keys=list(resolved.drug_keys),
        atc_keys=list(resolved.atc_keys),
    )


def _run_rule(
    request: Request,
    rule: CypherRule,
    seed_keys: list[str],
    *,
    limit: int,
) -> list[dict[str, object]]:
    """Evaluate one rule's Cypher for the scope, returning its rows.

    The rows carry ``subject``/``object`` plus ``premise_1``/``premise_2`` — the
    provenance ids of the two edges that produced the conclusion. One query
    answers both "what follows" and "on what evidence", which is why there is no
    premise-recovery pass here any more.
    """
    pool: StorePool = request.app.state.pool
    query, params = build_query(rule, seed_keys=tuple(seed_keys))
    # One row per conclusion at minimum, and a drug can pair with hundreds of
    # partners, so the ceiling scales with the scope rather than being a fixed
    # cap that would silently truncate a legitimate answer.
    params["limit"] = max(limit, 1)

    try:
        with pool.borrow() as store:
            result = store.execute_query(f"{query}\nLIMIT $limit", params)
    except TimeoutError:
        reject(
            KIND_TIMEOUT,
            422,
            (
                "Reasoning exceeded the query timeout. Narrow the scope "
                "(fewer drug_names or a tighter atc_prefix) and retry."
            ),
        )

    return [row for row in result.get("records", []) if isinstance(row, dict)]


def _conclusions(
    rule: CypherRule,
    rows: list[dict[str, object]],
) -> list[DerivedConclusion]:
    """Turn rule rows into attributed conclusions.

    A premise id that is missing is not dropped: it moves to
    ``uncited_premises``, because a conclusion resting partly on uncitable
    evidence is still a conclusion, and hiding the gap would overstate it.
    """
    conclusions: list[DerivedConclusion] = []
    for row in rows:
        subject = str(row.get("subject") or "")
        obj = str(row.get("object") or "")
        if not subject or not obj:
            continue

        citations: list[str] = []
        uncited: list[str] = []
        for key in ("premise_1", "premise_2"):
            value = row.get(key)
            if value:
                citations.append(str(value))
            else:
                uncited.append(f"{rule.head_predicate}:missing_{key}")

        conclusions.append(
            DerivedConclusion(
                fact=f"{rule.head_predicate}({subject}, {obj})",
                subject=subject,
                predicate=rule.head_predicate,
                object=obj,
                rule_id=rule.id,
                citations=citations,
                uncited_premises=uncited,
            )
        )
    return conclusions


@router.post("/reason", response_model=ReasonResponse)
def reason(request: Request, body: ReasonRequest) -> JSONResponse:
    """Derive facts by evaluating the named rule's Cypher against the graph."""
    settings = request.app.state.settings
    check_declared_sizes(body)

    if not body.load_from_graph:
        raise HTTPException(
            status_code=422,
            detail=(
                "Reasoning evaluates rules against the graph, so set "
                "'load_from_graph: true'. Request-supplied 'facts' and 'rules' are "
                "no longer supported: rules are versioned in this service."
            ),
        )

    applied = _resolve_rule(request, body)
    if applied is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Name the rule to apply with 'intent' or 'rule_id'. "
                "GET /rules lists what is available."
            ),
        )

    seed_keys, reason_range = _scope_keys(request, body)
    budget = FactBudget(settings.max_reasoning_facts)
    rows = _run_rule(request, applied, seed_keys, limit=body.limit)
    budget.check(len(rows), source=f"rule {applied.id!r} over the scoped graph")

    return JSONResponse(
        content=ReasonResponse(
            fact_count=len(rows),
            derived=sorted(
                f"{applied.head_predicate}({r.get('subject')}, {r.get('object')})" for r in rows
            ),
            bindings=None,
            labels={},
            node_types={},
            range=reason_range,
            rule=DerivedRuleInfo(**applied.describe()),
            conclusions=_conclusions(applied, rows),
            conclusions_complete=True,
        ).model_dump()
    )


@router.get("/rules", response_model=RuleLibraryResponse)
def list_rules(request: Request) -> JSONResponse:
    """List the versioned rule library.

    A caller has to be able to discover which intents exist before it can name
    one, and a rule set nobody can enumerate is one nobody can rely on.
    """
    library: RuleLibrary = request.app.state.rules
    payload = RuleLibraryResponse(rules=[DerivedRuleInfo(**r) for r in library.describe()])
    return JSONResponse(content=payload.model_dump())


__all__ = ["router", "verify_against_vocabulary"]

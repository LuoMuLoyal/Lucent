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

import logging
import re
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from semantica.reasoning.datalog_reasoner import DatalogReasoner

from ..graph import GraphExport, ScopeSpec, StorePool, resolve_scope
from ..reasoning import MAX_RECOVERED, ReasoningRule, RuleLibrary, recovery_is_complete
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
            #
            # Refused through `reject` so the reason carries a `kind`: this is
            # the one refusal a caller is most likely to misread as an answer,
            # and an unstructured detail left it indistinguishable from a
            # generic 422 in every client that branches on the code.
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
        return GraphExport(
            store,
            limit=body.limit,
            drug_keys=resolved.drug_keys,
            atc_keys=resolved.atc_keys,
            seed_drug_keys=resolved.seed_drug_keys,
            scope_label="explicit",
        )


def _resolve_rule(request: Request, body: ReasonRequest) -> ReasoningRule | None:
    """Look up the rule the request named, or refuse it.

    Naming a rule rather than sending its text is what keeps a conclusion
    attributable: the rule was reviewed in this repository, and the response can
    cite its id. Request-supplied rule text is still accepted, but it cannot be
    reported as a library rule and so produces no attributed conclusions.
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


def _conclusions(
    rule: ReasoningRule,
    derived: list[str],
    fact_assertions: dict[str, str | None],
    premises_by_conclusion: dict[str, list[str]],
    bindings: list[dict[str, str]] | None = None,
    query: str | None = None,
) -> list[DerivedConclusion]:
    """Build the attributed conclusion list for one rule application.

    Only facts the rule's own head predicate produces are turned into
    conclusions: ``derive_all`` returns the whole fact base, so reporting every
    fact would present the premises as if they were findings.

    When the request carried a ``query``, the conclusions are narrowed to what
    that query's bindings name. Without this the two halves of the response
    answered different questions: ``query: "potential_ddi(db00682, ?B)"``
    alongside ``conclusions`` holding *every* pair the rule derived — measured
    at 20,116 on a one-drug scope, of which the query matched a handful. A
    caller asking about one drug received the whole scope's derivations and had
    to re-filter them, and a model reading the envelope would find its answer
    buried under 20,000 unrelated pairs.

    Each premise is resolved through ``fact_assertions`` to the provenance id of
    the edge that asserts it. A premise with no id is not dropped — it moves to
    ``uncited_premises``, because a conclusion resting partly on uncitable
    evidence is still a conclusion, and hiding that would overstate it.
    """
    head = rule.head_predicate
    conclusions: list[DerivedConclusion] = []
    wanted = _requested_conclusions(rule, bindings, query) if bindings is not None else None

    for fact in derived:
        parsed = _parse_fact(fact)
        if parsed is None:
            continue
        predicate, subject, obj = parsed
        if predicate != head:
            continue
        if wanted is not None and (subject, obj) not in wanted:
            continue

        citations: list[str] = []
        uncited: list[str] = []
        for premise in premises_by_conclusion.get(fact, []):
            prov = fact_assertions.get(premise)
            if prov:
                citations.append(prov)
            else:
                uncited.append(premise)

        conclusions.append(
            DerivedConclusion(
                fact=fact,
                subject=subject,
                predicate=predicate,
                object=obj,
                rule_id=rule.id,
                citations=citations,
                uncited_premises=uncited,
            )
        )
    return conclusions


def _requested_conclusions(
    rule: ReasoningRule,
    bindings: list[dict[str, str]],
    query: str | None,
) -> set[tuple[str, str]]:
    """The ``(subject, object)`` pairs the request's query selects.

    Both halves are needed, and the reason is a property of the engine that is
    easy to get wrong: ``query('potential_ddi(db00682, ?B)')`` returns rows
    keyed by the **variables only** — measured as ``[{'B': 'db04951'}, ...]``,
    with no entry for the constant ``db00682``. So the bound arguments have to
    come from the query pattern and the free ones from the binding rows. Reading
    either alone selects nothing: variables-only skips every row because the
    pinned variable is missing, and pattern-only cannot enumerate the answers.

    A head variable that is neither pinned in the pattern nor present in a
    binding row selects nothing rather than acting as a wildcard. A caller that
    left a position open in a way the engine did not bind did not ask about every
    value of it.
    """
    head_variables = rule.head_variables
    if len(head_variables) != 2:
        # Conclusions are binary; a rule of another arity has no pair to select,
        # and guessing one would report facts the query never asked for.
        return set()

    subject_variable, object_variable = head_variables
    if query is None:
        # No query at all: every derived conclusion is in scope.
        return set()

    pinned = _pinned_arguments(query, rule.head_predicate)
    if pinned is None and not _calls_head(query, rule.head_predicate):
        # The query asks a different predicate, so it selects none of this
        # rule's conclusions.
        return set()
    # ``pinned`` is None for an all-variable head call such as
    # ``potential_ddi(?A, ?B)`` — nothing is pinned, which means every binding
    # row is selected, not that no row is. Returning the empty set here would
    # discard every answer to a well-formed question.
    pinned_subject, pinned_object = pinned if pinned is not None else (None, None)

    selected: set[tuple[str, str]] = set()
    for row in bindings:
        subject = pinned_subject or row.get(subject_variable)
        obj = pinned_object or row.get(object_variable)
        if subject is None or obj is None:
            continue
        selected.add((subject.lower(), obj.lower()))
    return selected


def _pinned_arguments(query: str | None, predicate: str) -> tuple[str | None, str | None] | None:
    """The constants a query's pattern pins, or ``None`` when it pins neither.

    Returns ``(subject, object)`` with ``None`` for a position the pattern left
    as a variable. ``None`` for the whole tuple means the query is absent or is
    not a call to this predicate, which is not the same as a pattern that pins
    nothing — the caller filters on that distinction.
    """
    if not query:
        return None

    # Reuse the fact parser: a Datalog query pattern and a fact have the same
    # `predicate(a, b)` shape, so parsing them separately would let the two
    # drift apart on whitespace or case.
    parsed = _parse_fact(query)
    if parsed is None:
        return None
    pattern_predicate, subject, obj = parsed
    if pattern_predicate != predicate:
        return None

    # A leading `?` marks a variable in the query syntax.
    pinned_subject = None if subject.startswith("?") else subject
    pinned_object = None if obj.startswith("?") else obj
    if pinned_subject is None and pinned_object is None:
        return None
    return (pinned_subject, pinned_object)


_FACT = re.compile(r"^([a-zA-Z0-9_]+)\(([^,]*),\s*([^,)]*)\)$")


def _calls_head(query: str, predicate: str) -> bool:
    """Whether a query pattern is a call to this rule's head predicate.

    Needed because ``_pinned_arguments`` collapses two different situations into
    ``None``: "asks a different predicate" and "asks this predicate but pins
    nothing". The first selects no conclusions; the second selects all of them.
    """
    parsed = _parse_fact(query)
    return parsed is not None and parsed[0] == predicate


def _parse_fact(fact: str) -> tuple[str, str, str] | None:
    """Split ``predicate(a, b)`` into parts, or ``None`` when not binary.

    Unary and n-ary facts are skipped rather than guessed at: the conclusion
    model names a subject and an object, so inventing them would misreport the
    rule's output.
    """
    match = _FACT.match(fact.strip())
    if not match:
        return None
    return match.group(1), match.group(2).strip(), match.group(3).strip()


def _premises_of(
    engine: DatalogReasoner,
    rule: ReasoningRule,
    facts: list[str],
    only: set[tuple[str, str]] | None = None,
) -> dict[str, list[str]]:
    """Map each conclusion to the ground premises that produced it.

    The engine does not report which body atoms fired for a derived fact, so the
    premises are recovered by re-running the rule's body against the fact base
    for the bound head arguments. This is what makes a conclusion auditable at
    all: without it the response could name the rule but not the evidence.
    """
    from ..reasoning.provenance_bridge import premises_for_conclusion

    return premises_for_conclusion(engine, rule, facts, only=only)


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

    applied = _resolve_rule(request, body)
    if applied is not None:
        try:
            engine.add_rule(applied.body)
        except (ValueError, IndexError) as exc:
            # A library rule that the engine rejects is our defect, not the
            # caller's: it passed the loader and still cannot be parsed.
            raise HTTPException(
                status_code=500,
                detail=f"Library rule {applied.id!r} failed to load: {exc}",
            ) from exc

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

    # Computed once and used for both the conclusion list and premise recovery,
    # so the two cannot disagree about which conclusions the request asked for.
    # Recovery is bounded (MAX_RECOVERED), and applying that bound to the wrong
    # population is not a rounding error: capping before narrowing spent the
    # whole budget on facts the caller never asked about.
    selected = (
        _requested_conclusions(applied, bindings, body.query)
        if applied is not None and bindings is not None
        else None
    )

    payload = ReasonResponse(
        fact_count=len(derived),
        derived=sorted(derived),
        bindings=bindings,
        labels=labels,
        node_types=node_types,
        range=reason_range,
        rule=DerivedRuleInfo(**applied.describe()) if applied is not None else None,
        conclusions=(
            _conclusions(
                applied,
                derived,
                fact_assertions,
                _premises_of(engine, applied, derived, selected),
                bindings,
                body.query,
            )
            if applied is not None
            else []
        ),
        conclusions_complete=(
            recovery_is_complete(applied, derived, MAX_RECOVERED, selected)
            if applied is not None
            else True
        ),
        fact_assertions=fact_assertions,
    )
    # Pairs with `export_loaded`: this line and that one together answer "was
    # the empty result a finding or an empty input?" from logs alone.
    _logger.info(
        "reason_finished",
        extra={
            "event": "reason_finished",
            "facts": payload.fact_count,
            "conclusions": len(payload.conclusions),
            "rule": payload.rule.id if payload.rule is not None else None,
            "truncated": reason_range.truncated if reason_range is not None else None,
            "conclusions_complete": payload.conclusions_complete,
        },
    )
    return JSONResponse(content=payload.model_dump())


@router.get("/rules", response_model=RuleLibraryResponse)
def list_rules(request: Request) -> JSONResponse:
    """List the versioned rule library.

    A caller has to be able to discover which intents exist before it can name
    one, and a rule set nobody can enumerate is one nobody can rely on.
    """
    library: RuleLibrary = request.app.state.rules
    payload = RuleLibraryResponse(rules=[DerivedRuleInfo(**r) for r in library.describe()])
    return JSONResponse(content=payload.model_dump())

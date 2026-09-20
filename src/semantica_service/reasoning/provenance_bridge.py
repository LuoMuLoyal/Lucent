"""Recover the premises behind a derived fact.

``DatalogReasoner.derive_all`` returns a flat list of facts. It does not say
which body atoms fired to produce any of them, and without that a conclusion
can name its rule but not its evidence — which is not attribution.

The engine exposes ``query(pattern)``, which does return bindings, so the
premises are recovered by re-running the rule's body with the head variables
bound to the conclusion's arguments. This is the same fixpoint the engine
already computed; re-deriving the binding is cheap next to loading the graph,
and it is the only route to premise-level citations the engine offers.
"""

from __future__ import annotations

from typing import Any

from semantica.reasoning.datalog_reasoner import DatalogReasoner

from .rules import ReasoningRule

#: Above this many conclusions, premise recovery stops early. Recovering a
#: binding costs a query per body atom per conclusion, so an unbounded recovery
#: would run longer than the fixpoint that produced the answers. Hitting the cap
#: is *reported* rather than silently producing an empty citation list: a
#: conclusion shown without evidence must be distinguishable from one whose
#: evidence was not looked up.
MAX_RECOVERED = 500


def premises_for_conclusion(
    engine: DatalogReasoner,
    rule: ReasoningRule,
    derived: list[str],
    limit: int = MAX_RECOVERED,
    only: set[tuple[str, str]] | None = None,
) -> dict[str, list[str]]:
    """Map each conclusion fact to the ground premises that entail it.

    Returns a dict keyed by the conclusion fact string, holding at most ``limit``
    entries. A conclusion outside that bound is simply absent, and the caller
    reports the shortfall through ``recovery_is_complete`` so a caller can tell
    "this conclusion has no recoverable premises" from "recovery stopped before
    reaching it" — collapsing those two would present an unattributed conclusion
    as an uncitable one.

    ``only`` narrows which conclusions are recovered at all, and it is applied
    **before** the cap rather than after. That ordering is the whole point: with
    a query in play the caller has said which conclusions it cares about, and
    capping first spent the entire budget on the alphabetically-first pairs of
    the whole fact base — measured on a one-drug scope, 20,116 conclusions and a
    cap of 500 meant the 67 the query actually asked about received no citations
    at all, while 500 unrelated ones did.

    Conclusions are processed in sorted order so the same request always
    recovers the same subset; iterating the database's order would make the
    citation set vary between identical calls.
    """
    conclusions = sorted(
        fact
        for fact in derived
        if _is_head_of(rule, fact) and (only is None or _pair_of(fact) in only)
    )
    recovered: dict[str, list[str]] = {}
    for fact in conclusions[:limit]:
        premises = _premises_for(engine, rule, fact)
        if premises:
            recovered[fact] = premises
    return recovered


def recovery_is_complete(
    rule: ReasoningRule,
    derived: list[str],
    limit: int,
    only: set[tuple[str, str]] | None = None,
) -> bool:
    """True when every selected conclusion of ``rule`` had its premises looked up."""
    selected = [
        fact
        for fact in derived
        if _is_head_of(rule, fact) and (only is None or _pair_of(fact) in only)
    ]
    return len(selected) <= limit


def _pair_of(fact: str) -> tuple[str, str] | None:
    """``(subject, object)`` of a binary fact, lower-cased, or ``None``."""
    args = _args_of(fact)
    if len(args) != 2:
        return None
    return (args[0].lower(), args[1].lower())


def _is_head_of(rule: ReasoningRule, fact: str) -> bool:
    """True when ``fact`` is a ground instance of the rule's head predicate."""
    head = rule.head_predicate
    return fact.startswith(f"{head}(")


def _premises_for(engine: DatalogReasoner, rule: ReasoningRule, conclusion: str) -> list[str]:
    """Ground body atoms that entail one conclusion.

    Each body atom is queried with the conclusion's arguments substituted for
    the head variables. The engine's ``query`` answers over the whole fact base
    it has already derived, so this reads the same closure the conclusion came
    from rather than recomputing it.
    """
    head_args = _args_of(conclusion)
    if not head_args:
        return []

    bindings = dict(zip(rule.head_variables, head_args, strict=False))
    premises: list[str] = []
    for atom in rule.body_atoms:
        pattern = _ground(atom, bindings)
        try:
            rows = engine.query(pattern)
        except (ValueError, KeyError):
            # An unparseable or unanswerable pattern simply yields no premises
            # for this atom; the conclusion still reports what it could resolve.
            continue
        for row in rows:
            grounded = _fully_grounded(atom, row, bindings)
            if grounded is not None and grounded not in premises:
                premises.append(grounded)
    return premises


def _args_of(fact: str) -> list[str]:
    """Split the arguments out of ``predicate(a, b)``."""
    start = fact.find("(")
    end = fact.rfind(")")
    if start == -1 or end == -1 or end <= start:
        return []
    return [part.strip() for part in fact[start + 1 : end].split(",") if part.strip()]


def _ground(atom: str, bindings: dict[str, str]) -> str:
    """Substitute the bindings we have into a body atom.

    Variables the head does not bind are left as variables on purpose: they are
    exactly the ones ``query`` is being asked to find, and substituting only the
    known arguments is what turns the atom into a lookup instead of a scan. In
    ``inhibits(A, E)`` with ``A`` bound to a drug, ``E`` stays open so the query
    returns the enzymes that drug inhibits.
    """
    name, args = _split_atom(atom)
    if name is None:
        return atom
    resolved: list[str] = []
    for arg in args:
        if _is_variable(arg) and arg in bindings:
            resolved.append(bindings[arg])
        else:
            resolved.append(arg)
    return f"{name}({', '.join(resolved)})"


def _fully_grounded(atom: str, row: dict[str, Any], bindings: dict[str, str]) -> str | None:
    """Render a body atom as a fact from a query row plus known bindings.

    ``DatalogReasoner.query`` returns only the *variables* it matched, keyed by
    name — a ground constant in the pattern (``inhibits(A, e1)``) comes back as
    ``{"A": "a"}`` with no entry for ``e1``. The constant therefore has to come
    from the pattern itself, and only the variables are looked up.

    Uppercase keys are checked as well as lowercase because the engine keys rows
    by the variable name as written in the pattern.
    """
    name, args = _split_atom(atom)
    if name is None:
        return None
    resolved: list[str] = []
    for arg in args:
        if _is_variable(arg):
            value = row.get(arg)
            if value is None:
                value = row.get(arg.lower())
            if value is None:
                value = bindings.get(arg)
            if value is None:
                return None
            resolved.append(str(value))
        else:
            resolved.append(arg)
    return f"{name}({', '.join(resolved)})"


def _split_atom(atom: str) -> tuple[str | None, list[str]]:
    """Split ``predicate(X, Y)`` into its name and argument list."""
    text = atom.strip()
    start = text.find("(")
    end = text.rfind(")")
    if start == -1 or end <= start:
        return None, []
    name = text[:start].strip()
    args = [part.strip() for part in text[start + 1 : end].split(",") if part.strip()]
    return name, args


def _is_variable(term: str) -> bool:
    """Variables start with an uppercase letter, as the engine defines them."""
    return bool(term) and term[0].isupper()

"""The rule engine: the three reviewed rules, as Cypher.

Replaces the Datalog/Oxigraph layer. The plan's §3.5 decision was to translate
the shipped rules into Cypher and keep ``/reason``'s semantics, and the
translation is direct because the rules are shape-for-shape joins over the same
graph:

=========== ================================================================
Datalog     Cypher
=========== ================================================================
``potential_ddi(A,B) :- inhibits(A,E), substrate_of(B,E), A != B``
            ``MATCH (a)-[:INHIBITS]->(e)<-[:SUBSTRATE_OF]-(b) WHERE a<>b``
``shares_target(A,B) :- acts_on(A,T), acts_on(B,T), A != B``
            ``MATCH (a)-[:ACTS_ON]->(t)<-[:ACTS_ON]-(b) WHERE a<>b``
``same_atc_class(A,B) :- in_atc_class(A,C), in_atc_class(B,C), A != B``
            ``MATCH (a)-[:IN_ATC_CLASS]->(c)<-[:IN_ATC_CLASS]-(b) WHERE a<>b``
=========== ================================================================

What this costs, stated plainly rather than discovered later:

* **Rules stop being data.** A rule used to be a line in ``rules/*.yaml`` that a
  reviewer could read and change without a release. These are now Cypher in a
  module, so changing one is a code change. That is the real price of the swap,
  and it is why the rules stay declared in the same reviewed shape — id, intent,
  summary, ``consumes`` — so the attribution half of the contract is unchanged.
* **``ReasonRequest.rules`` loses its backend.** There is no general-purpose
  engine to hand arbitrary rules to any more. Rather than keep a field that would
  either be ignored (silently wrong) or require re-implementing a Datalog
  evaluator (the thing being removed), the field is **removed** and the response
  says so. This is a breaking change, recorded in the changelog and mirrored in
  Lucent's client.

The inequality is native here: ``WHERE a <> b`` is evaluated by the database,
where the old path relied on an external engine's semantics being correct.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: The node property each rule's join resolves through. A drug is named by its
#: DrugBank id — the same key the export bridge and the caller's scope use, so a
#: conclusion's arguments mean the same thing they did under Datalog.
_DRUG_KEY = "drugbank_id"


@dataclass(frozen=True)
class CypherRule:
    """One reviewed rule: its metadata, plus the Cypher that evaluates it.

    ``cypher`` returns ``(subject, object, premises)`` rows. The premises are
    the ground facts the conclusion rests on, produced by the *same* query that
    derives it — which is strictly better than the old arrangement, where the
    engine reported only the conclusion and the premises had to be recovered by
    re-running the rule body and hoping the bindings lined up.
    """

    id: str
    intent: str
    summary: str
    citation_hint: str
    consumes: tuple[str, ...]
    head_predicate: str
    cypher: str

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "intent": self.intent,
            "summary": self.summary,
            "citation_hint": self.citation_hint,
            "consumes": list(self.consumes),
            "derives": self.head_predicate,
        }


_DRUG_MATCH = ""

# Every rule is written against drug keys passed as a parameter, so the scope is
# a bound list rather than interpolated text. `$drug_keys` is empty for an
# unscoped request, and each query treats an empty list as "no restriction" —
# see `_scoped` below, which renders that choice once instead of three times.
_POTENTIAL_DDI = f"""
MATCH (a:Drug)-[r1:INHIBITS]->(e:Protein)<-[r2:SUBSTRATE_OF]-(b:Drug)
WHERE a <> b {{scope_a}} {{scope_b}}
RETURN a.`{_DRUG_KEY}` AS subject, b.`{_DRUG_KEY}` AS object,
       r1.prov AS premise_1, r2.prov AS premise_2
"""

_SHARED_TARGET = f"""
MATCH (a:Drug)-[r1:ACTS_ON]->(t:Protein)<-[r2:ACTS_ON]-(b:Drug)
WHERE a <> b {{scope_a}} {{scope_b}}
RETURN a.`{_DRUG_KEY}` AS subject, b.`{_DRUG_KEY}` AS object,
       r1.prov AS premise_1, r2.prov AS premise_2
"""

_SAME_ATC = f"""
MATCH (a:Drug)-[r1:IN_ATC_CLASS]->(c:ATCClass)<-[r2:IN_ATC_CLASS]-(b:Drug)
WHERE a <> b {{scope_a}} {{scope_b}}
RETURN a.`{_DRUG_KEY}` AS subject, b.`{_DRUG_KEY}` AS object,
       r1.prov AS premise_1, r2.prov AS premise_2
"""


#: The shipped rules. Ids, intents and summaries are carried over unchanged from
#: ``rules/reasoning.yaml`` so an existing caller's ``intent`` still resolves and
#: ``/rules`` reports the same reviewed descriptions.
RULES: tuple[CypherRule, ...] = (
    CypherRule(
        id="potential_ddi_inhibitor_substrate",
        intent="interaction",
        summary=(
            "A drug that inhibits an enzyme and another drug that is a substrate of "
            "the same enzyme. This is a *potential* interaction, not a clinical "
            "finding: inhibition and metabolism are not the same as a contraindication."
        ),
        citation_hint="Each premise is a DrugBank assertion; cite both edges, not the conclusion.",
        consumes=("INHIBITS", "SUBSTRATE_OF"),
        head_predicate="potential_ddi",
        cypher=_POTENTIAL_DDI,
    ),
    CypherRule(
        id="shared_target_pair",
        intent="shared_target",
        summary=(
            "Two drugs that act on the same protein. Both flat assertions are "
            "directional; the derived pair is symmetric by construction because the "
            "rule is evaluated over every ordering."
        ),
        citation_hint="Cite the two protein-interaction edges that establish the shared target.",
        consumes=("ACTS_ON",),
        head_predicate="shares_target",
        cypher=_SHARED_TARGET,
    ),
    CypherRule(
        id="atc_class_membership",
        intent="atc_class",
        summary=(
            "Two drugs assigned to the same ATC class. The class is named by code "
            "only: no ATC name table exists in this deployment, so the code is the "
            "identifier and nothing here invents a human-readable class name."
        ),
        citation_hint="Cite the two IN_ATC_CLASS edges.",
        consumes=("IN_ATC_CLASS",),
        head_predicate="same_atc_class",
        cypher=_SAME_ATC,
    ),
)


@dataclass(frozen=True)
class RuleLibrary:
    """Every loaded rule, indexed by id and by intent.

    Kept as a class with the same accessors the previous YAML-backed library had,
    so ``/rules`` and rule resolution are unchanged from the caller's side.
    """

    rules: dict[str, CypherRule]

    def by_id(self, rule_id: str) -> CypherRule | None:
        return self.rules.get(rule_id)

    def by_intent(self, intent: str) -> CypherRule | None:
        """First rule for an intent, or ``None``."""
        for rule in self.rules.values():
            if rule.intent == intent:
                return rule
        return None

    def intents(self) -> list[str]:
        return sorted({rule.intent for rule in self.rules.values()})

    def describe(self) -> list[dict[str, Any]]:
        return [rule.describe() for rule in sorted(self.rules.values(), key=lambda r: r.id)]


def load_library() -> RuleLibrary:
    """Return the built-in rule library.

    There is no directory scan and no ``RULES_DIR`` setting any more: the rules
    are code. A deployment that still sets the old variable has no effect from it
    and should drop it, rather than believe a mounted rule set is being read.
    """
    return RuleLibrary(rules={rule.id: rule for rule in RULES})


def build_query(
    rule: CypherRule, *, seed_keys: tuple[str, ...] = ()
) -> tuple[str, dict[str, Any]]:
    """Render a rule's Cypher for a scope, plus its parameters.

    Everything is bound as a parameter and nothing is interpolated: a drug id
    comes from the request, so it is data.

    ``seed_keys`` are the drugs the caller actually named. A conclusion is in
    scope when the **seed** takes part in it — as either endpoint, because a
    drug's partners are precisely the drugs the caller did not name and a scope
    that excluded them could derive nothing.

    Scoping on the *resolved* key set instead was measured wrong. Naming Warfarin
    resolves to 511 drug keys (its interaction partners), and requiring only that
    some endpoint be among those 511 returned 500 shared-target pairs for a drug
    that actually has 26: the neighbours' own pairs are not pairs involving
    Warfarin, and they swamped the answer.

    An empty ``seed_keys`` means unrestricted (``scope_all``) rather than
    "restrict to nothing" — the two must not be spelled the same way, or an
    unscoped request would silently derive nothing.
    """
    if seed_keys:
        clause = f"AND (a.`{_DRUG_KEY}` IN $seed_keys OR b.`{_DRUG_KEY}` IN $seed_keys)"
        params: dict[str, Any] = {"seed_keys": list(seed_keys)}
    else:
        clause = ""
        params = {}

    query = rule.cypher.format(scope_a=clause, scope_b="")
    return query, params


def verify_against_vocabulary(library: RuleLibrary, relationship_types: set[str]) -> None:
    """Refuse any rule consuming a relationship type the graph does not have.

    A rule that cannot fire is the most expensive kind of wrong: it produces an
    empty result that reads like a negative finding. Catching it at boot turns a
    silent wrong answer into a failed start.

    An empty vocabulary means "the graph could not be read" rather than "the
    graph has no relationships": refusing every rule because a connection was
    momentarily unavailable would turn a transient dependency into a permanent
    startup failure. ``/health`` is what reports an unreadable graph.
    """
    if not relationship_types:
        return

    known = {name.upper() for name in relationship_types}
    for rule in library.rules.values():
        missing = [name for name in rule.consumes if name.upper() not in known]
        if missing:
            raise LibraryError(
                f"rule {rule.id!r} consumes {missing}, which the graph does not "
                f"have. Known types: {sorted(known)}"
            )


class LibraryError(RuntimeError):
    """The rule library is unusable, and that is a startup failure."""

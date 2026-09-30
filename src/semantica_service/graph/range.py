"""Turn a caller's scope into an explicit, deterministic set of graph keys.

Inference over a truncated graph is the failure mode this module exists to
prevent: "we did not derive it" must never be presented as "it does not hold",
and a random slice makes those two indistinguishable. The plan's rule is that
``/reason`` accepts an explicit scope and echoes back what it actually loaded.

A scope is named in terms a caller can produce — a drug name, an ATC prefix —
and resolved here against the graph into concrete fact keys. The resolution
itself is ordered by the graph's own identifier, so the same scope always
yields the same set.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from semantica.graph_store.neo4j_store import Neo4jStore

# A drug is named by its DrugBank id; a class by its ATC code. Both are the
# keys ``export._KEY_CANDIDATES`` prefers, so a resolved key is directly usable
# as a Datalog constant.
_DRUG_COLUMN = "drugbank_id"
_ATC_COLUMN = "code"

# Names are matched case-insensitively on both sides. The graph stores the
# display spelling ("Clopidogrel") and the caller may type any casing, so the
# comparison lowercases the input as well as the stored value. Without this the
# parameter named `drug_names` silently accepted only lowercase -- and rejected
# the exact spelling `/resolve` returns, which is the spelling a caller is most
# likely to supply. The failure text then read "matched nothing in the graph"
# about a drug the graph plainly holds, which is precisely the false negative
# the scope echo exists to prevent.
_RESOLVE_DRUGS = """
WITH [n IN $names | toLower(n)] AS wanted
MATCH (d:Drug)
WHERE toLower(d.name) IN wanted OR toLower(d.drugbank_id) IN wanted
RETURN d.drugbank_id AS key, d.name AS name
ORDER BY d.drugbank_id
LIMIT $limit
"""

_RESOLVE_ATC = """
MATCH (c:ATCClass)
WHERE c.code STARTS WITH $prefix
RETURN c.code AS key, coalesce(c.name, c.code) AS name
ORDER BY c.code
LIMIT $limit
"""

# Drugs linked to any of the resolved ATC classes. Ordered for the same reason
# every other export query is: an unordered LIMIT is a random sample.
_DRUGS_IN_ATC = """
UNWIND $codes AS code
MATCH (d:Drug)-[:IN_ATC_CLASS]->(c:ATCClass {code: code})
RETURN DISTINCT d.drugbank_id AS key, d.name AS name
ORDER BY d.drugbank_id
LIMIT $limit
"""

# Drugs that the scope's drugs interact with, in either direction. A scope
# named by a drug is a question *about that drug*, and its interaction partners
# are part of the answer — requiring both endpoints to be named by the caller
# would make every scope edge-free, because a caller names one drug at a time.
#
# Both directions are read because the source data is single-directional: the
# interaction list only names a drug on the source side for 4,218 of 19,842
# rows (the plan's D2). Warfarin, the most asked-about drug in this graph, has
# 530 incoming edges and no outgoing ones at all.
#
# The two directions are two statements rather than one undirected pattern:
# `-[r]-` cannot use either endpoint index and an undirected scan over 200,182
# interaction edges exceeds the connection's statement_timeout (measured).
_INTERACTION_PARTNERS_OUT = """
UNWIND $keys AS seed
MATCH (a:Drug {drugbank_id: seed})-[:INTERACTS_WITH]->(b:Drug)
RETURN DISTINCT b.drugbank_id AS key, b.name AS name
ORDER BY b.drugbank_id
LIMIT $limit
"""

_INTERACTION_PARTNERS_IN = """
UNWIND $keys AS seed
MATCH (a:Drug)-[:INTERACTS_WITH]->(b:Drug {drugbank_id: seed})
RETURN DISTINCT a.drugbank_id AS key, a.name AS name
ORDER BY a.drugbank_id
LIMIT $limit
"""

# The proteins a scope's drugs act on. A target is not a drug, so it can never
# be named by the caller, yet it is exactly what makes an interaction
# mechanistic rather than a bare pair of names.
_PROTEIN_NEIGHBOURS = """
UNWIND $keys AS seed
MATCH (a:Drug {drugbank_id: seed})-[r]->(p:Protein)
WHERE NOT type(r) IN ['IN_ATC_CLASS', 'SUBCLASS_OF']
RETURN DISTINCT p.uniprot_id AS key, p.name AS name
ORDER BY p.uniprot_id
LIMIT $limit
"""


@dataclass(frozen=True)
class ScopeSpec:
    """What the caller asked to reason over.

    All fields are optional and combine as a union: naming drugs *and* an ATC
    prefix reasons over both sets. An empty spec is not a scope — it is the
    absence of one, which the caller signals with ``scope_all``.
    """

    drug_names: tuple[str, ...] = ()
    atc_prefixes: tuple[str, ...] = ()
    limit: int = 1000

    @property
    def is_empty(self) -> bool:
        return not self.drug_names and not self.atc_prefixes


@dataclass
class ResolvedScope:
    """The graph keys a scope selected, plus how many were asked for."""

    drug_keys: list[str] = field(default_factory=list)
    atc_keys: list[str] = field(default_factory=list)
    #: The keys the caller actually named, as opposed to the neighbours that
    #: came along with them. A response has to keep these apart: "the scope is
    #: warfarin" and "the scope is warfarin plus 530 interaction partners" are
    #: different claims about what was reasoned over.
    seed_drug_keys: list[str] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)
    # True when a resolution query hit its limit, so the scope is a prefix of
    # what the caller named rather than all of it.
    truncated: bool = False

    @property
    def is_empty(self) -> bool:
        return not self.drug_keys and not self.atc_keys

    def describe(self) -> dict[str, object]:
        """The scope as it is echoed back in a response."""
        return {
            "drug_count": len(self.drug_keys),
            "atc_count": len(self.atc_keys),
            "seed_drug_keys": self.seed_drug_keys,
            "drug_keys": self.drug_keys,
            "atc_keys": self.atc_keys,
            "truncated": self.truncated,
        }


def _rows(result: dict[str, Any], what: str) -> list[dict[str, Any]]:
    if not result.get("success"):
        raise RuntimeError(f"AGE {what} resolution failed: {result.get('error')}")
    records = result.get("records")
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)]


def resolve_scope(store: Neo4jStore, spec: ScopeSpec) -> ResolvedScope:
    """Resolve a named scope into graph keys, deterministically.

    Every query here carries an ``ORDER BY`` before its ``LIMIT``. That is the
    whole point of the module: an unordered ``LIMIT`` returns a different set
    on each run, which would make two identical reasoning requests disagree
    about what the graph contains.

    The result is the named drugs **plus their neighbourhood** — interaction
    partners and protein neighbours. A caller names one drug at a time, so a
    scope that contained only what was named would have no edges in it at all,
    and an edge-free fact base can derive nothing whatever the rules say.
    """
    resolved = ResolvedScope()
    if spec.is_empty:
        return resolved

    if spec.drug_names:
        _collect_drugs(
            store,
            resolved,
            _RESOLVE_DRUGS,
            {"names": list(spec.drug_names), "limit": spec.limit},
            "drug",
            spec.limit,
        )

    if spec.atc_prefixes:
        for prefix in spec.atc_prefixes:
            rows = _rows(
                store.execute_query(
                    _RESOLVE_ATC,
                    {"prefix": prefix, "limit": spec.limit},
                ),
                "ATC class",
            )
            for row in rows:
                key = row.get("key")
                if key not in (None, ""):
                    resolved.atc_keys.append(str(key))
            resolved.truncated = resolved.truncated or len(rows) >= spec.limit

        if resolved.atc_keys:
            _collect_drugs(
                store,
                resolved,
                _DRUGS_IN_ATC,
                {"codes": resolved.atc_keys, "limit": spec.limit},
                "ATC member drug",
                spec.limit,
            )

    if spec.drug_names:
        # The seeds are the named drugs only. Expansion reads them and appends
        # to a separate list, so a partner's own partners can never be reached:
        # warfarin cites 530 drugs, and one more hop would pull in most of the
        # graph and make the scope meaningless as a bound.
        resolved.seed_drug_keys = sorted(dict.fromkeys(resolved.drug_keys))
        resolved.drug_keys = list(resolved.seed_drug_keys)
        _collect_neighbours(store, resolved, resolved.seed_drug_keys, spec.limit)

    resolved.drug_keys = sorted(dict.fromkeys(resolved.drug_keys))
    resolved.atc_keys = sorted(dict.fromkeys(resolved.atc_keys))
    return resolved


def _collect_drugs(
    store: Neo4jStore,
    resolved: ResolvedScope,
    query: str,
    parameters: dict[str, Any],
    what: str,
    limit: int,
) -> None:
    """Run a drug-returning resolution query into ``resolved``."""
    rows = _rows(store.execute_query(query, parameters), what)
    for row in rows:
        key = row.get("key")
        if key in (None, ""):
            continue
        resolved.drug_keys.append(str(key))
        name = row.get("name")
        if name not in (None, ""):
            resolved.labels[str(key).lower()] = str(name)
    resolved.truncated = resolved.truncated or len(rows) >= limit


def _collect_neighbours(
    store: Neo4jStore,
    resolved: ResolvedScope,
    seeds: list[str],
    limit: int,
) -> None:
    """Expand the named drugs into their interaction and protein neighbourhood.

    The expansion is bounded by ``limit`` and ordered, and hitting that bound
    sets ``truncated`` — a scope quietly capped at its first N neighbours would
    be the same false-negative machine the ordered export exists to remove.
    """
    for query in (
        _INTERACTION_PARTNERS_OUT,
        _INTERACTION_PARTNERS_IN,
        _PROTEIN_NEIGHBOURS,
    ):
        rows = _rows(store.execute_query(query, {"keys": seeds, "limit": limit}), "neighbour")
        for row in rows:
            key = row.get("key")
            if key in (None, ""):
                continue
            resolved.drug_keys.append(str(key))
            name = row.get("name")
            if name not in (None, ""):
                resolved.labels[str(key).lower()] = str(name)
        resolved.truncated = resolved.truncated or len(rows) >= limit

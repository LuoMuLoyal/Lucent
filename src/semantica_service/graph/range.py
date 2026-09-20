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

from semantica.graph_store.age_store import ApacheAgeStore

# A drug is named by its DrugBank id; a class by its ATC code. Both are the
# keys ``export._KEY_CANDIDATES`` prefers, so a resolved key is directly usable
# as a Datalog constant.
_DRUG_COLUMN = "drugbank_id"
_ATC_COLUMN = "code"

_RESOLVE_DRUGS = """
MATCH (d:Drug)
WHERE toLower(d.name) IN $names OR d.drugbank_id IN $names
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


def resolve_scope(store: ApacheAgeStore, spec: ScopeSpec) -> ResolvedScope:
    """Resolve a named scope into graph keys, deterministically.

    Every query here carries an ``ORDER BY`` before its ``LIMIT``. That is the
    whole point of the module: an unordered ``LIMIT`` returns a different set
    on each run, which would make two identical reasoning requests disagree
    about what the graph contains.
    """
    resolved = ResolvedScope()
    if spec.is_empty:
        return resolved

    if spec.drug_names:
        rows = _rows(
            store.execute_query(
                _RESOLVE_DRUGS,
                {"names": list(spec.drug_names), "limit": spec.limit},
            ),
            "drug",
        )
        for row in rows:
            key = row.get("key")
            if key in (None, ""):
                continue
            resolved.drug_keys.append(str(key))
            name = row.get("name")
            if name not in (None, ""):
                resolved.labels[str(key).lower()] = str(name)
        resolved.truncated = resolved.truncated or len(rows) >= spec.limit

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
                if key in (None, ""):
                    continue
                resolved.atc_keys.append(str(key))
            resolved.truncated = resolved.truncated or len(rows) >= spec.limit

        if resolved.atc_keys:
            rows = _rows(
                store.execute_query(
                    _DRUGS_IN_ATC,
                    {"codes": resolved.atc_keys, "limit": spec.limit},
                ),
                "ATC member drug",
            )
            for row in rows:
                key = row.get("key")
                if key in (None, ""):
                    continue
                resolved.drug_keys.append(str(key))
                name = row.get("name")
                if name not in (None, ""):
                    resolved.labels[str(key).lower()] = str(name)
            resolved.truncated = resolved.truncated or len(rows) >= spec.limit

    # A drug reachable through two paths must appear once, or the fact list
    # would carry a duplicate and the counts would overstate the scope.
    resolved.drug_keys = sorted(dict.fromkeys(resolved.drug_keys))
    resolved.atc_keys = sorted(dict.fromkeys(resolved.atc_keys))
    return resolved

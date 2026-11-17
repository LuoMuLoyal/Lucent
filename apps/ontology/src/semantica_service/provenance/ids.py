"""The provenance id scheme, shared by the import script and the reader.

An id names the *source row* an assertion was derived from, which makes it
readable on its own and resolvable without a lookup table::

    lucent:drugbank_drugs/DB00004/drug_interactions/DB14766
        one entry of that drug's interaction list   -> INTERACTS_WITH edge
    lucent:drugbank_drugs/DB00004/atc_codes/L01XX29 -> IN_ATC_CLASS edge
    lucent:drugbank_drug_targets/DB00004/<target>/enzyme
        one drug->target source row                 -> the row entity
    lucent:drugbank_drug_targets/DB00004/<target>/enzyme/INHIBITS
        one recognised action verb of that row      -> the edge
    lucent:derived/atc_hierarchy/L01X/L01XX29
        a class link materialised from ATC prefixes -> SUBCLASS_OF edge
    lucent:ingest/<source_key>@<export date>        -> the ingest activity

It lives here, in the service package, rather than next to the writer: the
reader has to recognise an id inside a Cypher result, and two definitions of
the prefix would be one definition too many.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

#: Every id starts with this, which is also what makes one recognisable in a
#: result set without knowing which column the query put it in.
PREFIX = "lucent:"

#: Recursion ceiling when looking for ids inside a returned agtype value.
_MAX_DEPTH = 4


def interaction_prov_id(drug: str, other: str) -> str:
    """Id of one drug->drug interaction entry."""
    return f"{PREFIX}drugbank_drugs/{drug}/drug_interactions/{other}"


def atc_prov_id(drug: str, code: str) -> str:
    """Id of one drug->ATC-class link."""
    return f"{PREFIX}drugbank_drugs/{drug}/atc_codes/{code}"


def target_row_prov_id(drug: str, target: str, relation_kind: str) -> str:
    """Id of one drug->target source row, independent of the verbs it carries."""
    return f"{PREFIX}drugbank_drug_targets/{drug}/{target}/{relation_kind}"


def target_edge_prov_id(drug: str, target: str, relation_kind: str, rel_type: str) -> str:
    """Id of the edge one recognised action verb of that row produced."""
    return f"{target_row_prov_id(drug, target, relation_kind)}/{rel_type}"


def subclass_prov_id(parent: str, child: str) -> str:
    """Id of a materialised ATC class link."""
    return f"{PREFIX}derived/atc_hierarchy/{parent}/{child}"


def activity_prov_id(source_key: str, exported_at: str) -> str:
    """Id of an ingest activity, keyed on its source and the export date."""
    return f"{PREFIX}ingest/{source_key}@{exported_at}"


def materialise_activity_prov_id(exported_at: str) -> str:
    """Id of the activity that materialised edges no source row asserts."""
    return f"{PREFIX}materialise/atc_hierarchy@{exported_at}"


def is_provenance_id(value: object) -> bool:
    """True when a value is one of these ids."""
    return isinstance(value, str) and value.startswith(PREFIX)


def _walk(value: Any, depth: int) -> Iterable[str]:
    """Yield every id inside a value, descending into AGE's nested shapes.

    A query that returns ``r`` rather than ``r.prov`` hands back the whole
    relationship — ``{"type": ..., "properties": {"prov": ...}}`` — so the scan
    cannot stop at the top level of a row.
    """
    if depth > _MAX_DEPTH:
        return
    if is_provenance_id(value):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _walk(item, depth + 1)
    elif isinstance(value, (list, tuple, set, frozenset)):
        for item in value:
            yield from _walk(item, depth + 1)


def collect_provenance_ids(rows: Iterable[Mapping[str, Any]], limit: int) -> tuple[list[str], bool]:
    """Ids present in a result set, in first-seen order.

    Returns ``(ids, truncated)``. ``truncated`` is true when the result set held
    more ids than ``limit``: resolving a capped list silently would turn "the
    answer rests on 900 assertions" into a citation list that appears complete,
    which is the one thing a citation must never do.
    """
    seen: dict[str, None] = {}
    for row in rows:
        for key, value in row.items():
            if key == "prov" and is_provenance_id(value):
                seen.setdefault(str(value), None)
                continue
            for found in _walk(value, 0):
                seen.setdefault(found, None)
            if len(seen) > limit:
                return list(seen)[:limit], True
    ids = list(seen)
    return ids[:limit], len(ids) > limit

"""Interaction directionality: the source-column gap, and how it is bridged.

The DrugBank interaction table names a drug in a source column and a partner in
a target column. On import, only 4,218 of 19,842 interaction rows carried a value
in the source column, so the graph's ``INTERACTS_WITH`` edges are effectively
one-directional: measured on the live graph, 815 distinct drugs appear as a
source, 820 as a target, and **80 drugs never appear as a source at all**.

Warfarin is one of them. It has 0 outgoing edges and 530 incoming, so any
outgoing-only traversal reports that warfarin interacts with nothing — a
confident, specific, wrong answer to the most commonly asked question in this
domain.

Bridging it correctly means two things, and the second is the one that is easy
to get wrong:

1. **Read both directions.** The scope resolver already does; this module is
   what makes the *reasoning vocabulary* symmetric too, so a rule written as
   ``interacts_with(A, B)`` fires regardless of which way the stored edge runs.

2. **Preserve the direction as metadata.** The edges are not actually symmetric:
   only 197,648 of 200,182 have a reverse, and the description on each edge is
   written from the source's point of view ("The metabolism of Ponesimod can be
   decreased when combined with Lemborexant"). Flipping the edge without
   recording which way it originally ran would destroy the only record of who
   the statement is about.

So a reversed edge is emitted with the original orientation attached, and a fact
derived over it can say which way the source data ran.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

#: Relationship types whose meaning does not depend on which endpoint the data
#: happened to name first. Symmetric relations are the ones a reader would not
#: be surprised to see stated either way round.
SYMMETRIC_RELATIONSHIPS = frozenset(
    {
        "INTERACTS_WITH",
        "SHARES_TARGET",
        "SAME_ATC_CLASS",
    }
)

#: Property added to a reversed edge, naming the orientation the source data
#: used. Absent on an edge stored in its original direction.
ORIENTATION_PROPERTY = "orientation"

#: The value of :data:`ORIENTATION_PROPERTY` on a reversed edge.
REVERSED = "reversed"

#: The provenance path segment that separates the source drug from the rest of
#: the id: ``lucent:drugbank_drugs/<source>/drug_interactions/<target>``.
_PROV_SOURCE = re.compile(r"drugbank_drugs/([^/]+)/", re.IGNORECASE)


@dataclass(frozen=True)
class Orientation:
    """Which way the underlying assertion ran."""

    source: str | None
    """The drug the source data named first, or ``None`` when it cannot be read."""

    reversed_edge: bool
    """Whether the edge this fact was built from is itself a reversed one."""

    @property
    def known(self) -> bool:
        return self.source is not None

    def describe(self) -> dict[str, Any]:
        return {"source": self.source, "reversed": self.reversed_edge}


def source_drug_from_prov(prov: str | None) -> str | None:
    """Recover the source drug from a provenance id, or ``None``.

    The provenance path is the only place the original orientation survives: the
    edge itself has no source column, because it was empty for most rows. Reading
    it back is what lets a conclusion state who the assertion was about.
    """
    if not prov:
        return None
    match = _PROV_SOURCE.search(prov)
    if match is None:
        return None
    return match.group(1).lower()


def orientation_of(edge: dict[str, Any]) -> Orientation:
    """The orientation of one exported edge.

    A reversed edge carries :data:`ORIENTATION_PROPERTY`; a natural one does not.
    The source drug is read from the provenance id, falling back to the edge's
    own source endpoint when the id does not name one.
    """
    properties = edge.get("properties") or {}
    reversed_edge = str(properties.get(ORIENTATION_PROPERTY, "")).lower() == REVERSED
    source = source_drug_from_prov(_prov_of(properties))
    if source is None:
        # No provenance id to read: the endpoint the edge runs from is the best
        # available answer, and it is the right one for a natural edge.
        endpoint = edge.get("source")
        source = str(endpoint).lower() if endpoint is not None else None
    return Orientation(source=source, reversed_edge=reversed_edge)


def _prov_of(properties: dict[str, Any]) -> str | None:
    value = properties.get("prov")
    return None if value in (None, "") else str(value)


def is_symmetric(rel_type: str) -> bool:
    """Whether a relationship type means the same read either way round."""
    return rel_type.upper() in SYMMETRIC_RELATIONSHIPS


def mirror_edge(edge: dict[str, Any]) -> dict[str, Any] | None:
    """The reverse of an edge, marked as reversed, or ``None`` if not mirrorable.

    Returns ``None`` for a self-loop (a drug interacting with itself is not a
    statement the source data makes) and for relation types whose meaning is
    directional, where flipping would assert something the data never said.
    """
    rel_type = str(edge.get("type") or "")
    if not is_symmetric(rel_type):
        return None

    source = edge.get("source")
    target = edge.get("target")
    if source is None or target is None or source == target:
        return None

    properties = dict(edge.get("properties") or {})
    properties[ORIENTATION_PROPERTY] = REVERSED
    return {
        "source": target,
        "target": source,
        "type": rel_type,
        # The reversed edge is the same assertion, so it keeps the same
        # provenance id: a citation must resolve to one row, not two.
        "properties": properties,
    }


def mirror_edges(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add the reverse of every symmetric edge that does not already have one.

    An edge whose reverse is already present is left alone: adding a duplicate
    would make a Datalog fact count as two, and every conclusion resting on it
    would look better supported than it is.
    """
    existing = {
        (
            edge_key(edge.get("source")),
            edge_key(edge.get("target")),
            str(edge.get("type")),
        )
        for edge in edges
    }

    added: list[dict[str, Any]] = []
    for edge in edges:
        mirror = mirror_edge(edge)
        if mirror is None:
            continue
        key = (
            edge_key(mirror["source"]),
            edge_key(mirror["target"]),
            str(mirror["type"]),
        )
        if key in existing:
            continue
        existing.add(key)
        added.append(mirror)
    return added


def edge_key(value: Any) -> str:
    """Compare an endpoint by its business key, case-insensitively.

    Public because the export sorts by it too: two spellings of the same drug
    would otherwise order differently and the retained prefix of a capped mirror
    would vary between identical requests.
    """
    return "" if value is None else str(value).strip().lower()

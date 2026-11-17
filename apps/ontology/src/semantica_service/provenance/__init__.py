"""Provenance for the English-side graph: the id scheme and its read side.

An answer built from the graph is only auditable if each assertion it rests on
can be traced back to the source row that produced it. The chain is:

``r.prov`` on the edge (written by ``scripts/add_edge_provenance.py``)
    -> a hash-chained entry in the Postgres provenance store
    -> a source table, a source row key, and the quoted source text.

``ids`` owns the id scheme — the writer and the reader must agree on it, so
there is one definition. ``reader`` resolves ids against the store. ``provo``
renders a citation as W3C PROV-O for a caller that wants the interoperable
form rather than this service's JSON.
"""

from .ids import (
    PREFIX,
    activity_prov_id,
    atc_prov_id,
    collect_provenance_ids,
    interaction_prov_id,
    is_provenance_id,
    materialise_activity_prov_id,
    subclass_prov_id,
    target_edge_prov_id,
    target_row_prov_id,
)
from .provo import to_jsonld, to_turtle
from .reader import ProvenanceReader, ProvenanceRecord, ProvenanceUnavailable, Resolution

__all__ = [
    "PREFIX",
    "ProvenanceReader",
    "ProvenanceRecord",
    "ProvenanceUnavailable",
    "Resolution",
    "activity_prov_id",
    "atc_prov_id",
    "collect_provenance_ids",
    "interaction_prov_id",
    "is_provenance_id",
    "materialise_activity_prov_id",
    "subclass_prov_id",
    "target_edge_prov_id",
    "target_row_prov_id",
    "to_jsonld",
    "to_turtle",
]

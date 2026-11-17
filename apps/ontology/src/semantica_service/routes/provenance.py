"""POST /provenance — resolve provenance ids into citations.

Every edge of this graph carries a `prov` id naming the source row it was
derived from (written at import time by ``scripts/add_edge_provenance.py``).
A `/query` result therefore cites its own evidence, and this endpoint is how
that citation is turned into something a caller can show or check: the source
table, the row key, the quoted source text, the import activity that produced
it, and the integrity of the hash chain the entry sits in.

It is a POST rather than a path parameter because the ids contain ``/`` and
``:`` — a path-shaped endpoint would need escaping at every call site for no
gain, and a batch of ids is the normal case.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..provenance import ProvenanceReader, ProvenanceRecord, to_jsonld, to_turtle
from .schemas import (
    ChainReport,
    ProvenanceRecordModel,
    ProvenanceRequest,
    ProvenanceResponse,
)

router = APIRouter(tags=["provenance"])


def to_models(records: list[ProvenanceRecord]) -> list[ProvenanceRecordModel]:
    """Project records onto the wire models."""
    return [ProvenanceRecordModel.model_validate(record.to_dict()) for record in records]


def chain_report(reader: ProvenanceReader) -> ChainReport:
    """The chain's integrity, as a model."""
    return ChainReport.model_validate(reader.verify_chain())


@router.post("/provenance", response_model=ProvenanceResponse)
def provenance(request: Request, body: ProvenanceRequest) -> JSONResponse:
    """Return the citation behind each id, with its lineage and chain state."""
    reader: ProvenanceReader = request.app.state.provenance
    resolution = reader.resolve(body.ids)

    lineage: list[ProvenanceRecord] = []
    if body.lineage:
        seen = {record.id for record in resolution.records}
        for entity_id in body.ids:
            for ancestor in reader.lineage(entity_id):
                if ancestor.id not in seen:
                    seen.add(ancestor.id)
                    lineage.append(ancestor)

    payload = ProvenanceResponse(
        records=to_models(resolution.records),
        missing=resolution.missing,
        lineage=to_models(lineage),
        chain=chain_report(reader),
    )

    if body.format != "records":
        cited = [*resolution.records, *lineage]
        payload.provo = to_turtle(cited) if body.format == "turtle" else to_jsonld(cited)

    if not resolution.available:
        payload.error = resolution.error

    return JSONResponse(content=payload.model_dump())


@router.get("/provenance/verify", response_model=ChainReport)
def verify(request: Request) -> JSONResponse:
    """Walk the whole hash chain and report whether it is intact.

    Reading this is what makes the audit trail more than a table of rows: every
    entry's checksum covers its predecessor's, so a row deleted or edited after
    the import breaks the chain at that point.
    """
    reader: ProvenanceReader = request.app.state.provenance
    return JSONResponse(content=chain_report(reader).model_dump())

"""PROV-O rendering of a citation, or of a cited set.

semantica's ``ProvenanceManager.export_prov`` renders an entire store, which is
right for an audit export of a few hundred entries and unusable for a citation
whose store holds two hundred thousand. A citation needs one assertion rendered
on demand, so this builds that small graph directly.

The shape is PROV-O, and it is the reference implementation's own modelling
rather than a loose one:

* the assertion is a ``prov:Entity``;
* the import that produced it is a ``prov:Activity``, which ``prov:used`` the
  source table;
* the source row is a ``prov:Entity`` the assertion ``prov:wasDerivedFrom``,
  carrying the row key and the quoted source text;
* the record's agent becomes a ``prov:Agent`` — subclassed only when the agent
  type actually names a PROV-O agent class. A dataset is not an agent in PROV-O,
  so ``source_dataset`` gets a label and a ``prov:type`` literal instead of a
  false ``prov:SoftwareAgent`` claim.

``prov:wasDerivedFrom`` is also what carries a verb edge back to the source row
it was recognised from, so a lineage walk and an RDF walk say the same thing.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from typing import Any
from urllib.parse import quote

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, RDF, RDFS, XSD

# Imported rather than redefined: semantica mints entity URIs as
# ``DEFAULT_BASE_URI + entity_id``, and an entity that resolves in both exports
# is the point of sharing the base.
from semantica.provenance.manager import DEFAULT_BASE_URI

from .reader import ProvenanceRecord

PROV = Namespace("http://www.w3.org/ns/prov#")

#: Which ``prov:`` subclass an agent type actually is, where it is one.
_AGENT_CLASSES = {
    "software_agent": PROV.SoftwareAgent,
    "person": PROV.Person,
    "organization": PROV.Organization,
}


def entity_uri(record_id: str, base_uri: str = DEFAULT_BASE_URI) -> str:
    """URI of an assertion entity, identical to semantica's own export."""
    return f"{base_uri}{record_id}"


def source_uri(record: ProvenanceRecord, base_uri: str = DEFAULT_BASE_URI) -> str:
    """URI of the source row a record was derived from.

    Minted from the table and the row key, percent-encoded because a row key
    contains characters (spaces, commas, ``=``) that a URI cannot carry raw.
    """
    key = quote(f"{record.source_document}#{record.source_location}", safe="")
    return f"{base_uri}source/{key}"


def activity_uri(activity_id: str, base_uri: str = DEFAULT_BASE_URI) -> str:
    return f"{base_uri}activity/{quote(activity_id, safe='')}"


def agent_uri(agent_id: str, base_uri: str = DEFAULT_BASE_URI) -> str:
    return f"{base_uri}agent/{quote(agent_id, safe='')}"


def build_graph(
    records: Sequence[ProvenanceRecord],
    *,
    base_uri: str = DEFAULT_BASE_URI,
) -> Graph:
    """Build the PROV-O graph for a set of cited records."""
    graph = Graph()
    graph.bind("prov", PROV)
    graph.bind("dcterms", DCTERMS)
    graph.bind("rdfs", RDFS)

    for record in records:
        entity = URIRef(entity_uri(record.id, base_uri))
        graph.add((entity, RDF.type, PROV.Entity))
        graph.add((entity, DCTERMS.identifier, Literal(record.id)))

        label = _assertion_label(record)
        if label:
            graph.add((entity, RDFS.label, Literal(label)))
        if record.timestamp:
            graph.add(
                (
                    entity,
                    PROV.generatedAtTime,
                    Literal(record.timestamp, datatype=XSD.dateTime),
                )
            )
        if record.confidence is not None:
            graph.add((entity, PROV.value, Literal(record.confidence)))

        source = URIRef(source_uri(record, base_uri))
        graph.add((entity, PROV.wasDerivedFrom, source))
        graph.add((source, RDF.type, PROV.Entity))
        graph.add((source, DCTERMS.source, Literal(record.source_document)))
        graph.add((source, DCTERMS.identifier, Literal(record.source_location)))
        if record.source_quote:
            graph.add((source, PROV.value, Literal(record.source_quote)))

        if record.parent_entity_id:
            graph.add(
                (
                    entity,
                    PROV.wasDerivedFrom,
                    URIRef(entity_uri(record.parent_entity_id, base_uri)),
                )
            )

        if record.activity_id:
            activity = URIRef(activity_uri(record.activity_id, base_uri))
            graph.add((entity, PROV.wasGeneratedBy, activity))
            graph.add((activity, RDF.type, PROV.Activity))
            graph.add((activity, RDFS.label, Literal(record.activity_id)))
            # The activity consumed the source table the row lives in.
            used = URIRef(f"{base_uri}source/{quote(record.source_document, safe='')}")
            graph.add((activity, PROV.used, used))
            graph.add((used, RDF.type, PROV.Entity))
            graph.add((used, RDFS.label, Literal(record.source_document)))

        if record.agent_id:
            agent = URIRef(agent_uri(record.agent_id, base_uri))
            graph.add((entity, PROV.wasAttributedTo, agent))
            graph.add((agent, RDF.type, PROV.Agent))
            graph.add((agent, RDFS.label, Literal(record.agent_id)))
            if record.agent_type:
                prov_class = _AGENT_CLASSES.get(record.agent_type)
                if prov_class is not None:
                    graph.add((agent, RDF.type, prov_class))
                else:
                    graph.add((agent, PROV.type, Literal(record.agent_type)))
                if record.activity_id:
                    graph.add(
                        (
                            URIRef(activity_uri(record.activity_id, base_uri)),
                            PROV.wasAssociatedWith,
                            agent,
                        )
                    )

    return graph


def _assertion_label(record: ProvenanceRecord) -> str | None:
    """``subject EDGE_TYPE object`` when the record's metadata carries it.

    The label is what makes a rendered citation readable without the reader
    knowing the id scheme.
    """
    metadata = record.metadata or {}
    subject = metadata.get("subject")
    edge_type = metadata.get("edge_type")
    target = metadata.get("object")
    if subject and edge_type and target:
        return f"{subject} {edge_type} {target}"
    return None


def to_turtle(records: Sequence[ProvenanceRecord], *, base_uri: str = DEFAULT_BASE_URI) -> str:
    """Serialize the citation as Turtle."""
    return build_graph(records, base_uri=base_uri).serialize(format="turtle")


def to_jsonld(records: Sequence[ProvenanceRecord], *, base_uri: str = DEFAULT_BASE_URI) -> Any:
    """Serialize the citation as JSON-LD.

    Derived from the same graph as the Turtle output, so the two cannot drift.
    """
    payload = build_graph(records, base_uri=base_uri).serialize(format="json-ld")
    return json.loads(payload)


def all_records(records: Iterable[ProvenanceRecord]) -> list[ProvenanceRecord]:
    """Deduplicate by id, keeping first-seen order."""
    seen: dict[str, ProvenanceRecord] = {}
    for record in records:
        seen.setdefault(record.id, record)
    return list(seen.values())

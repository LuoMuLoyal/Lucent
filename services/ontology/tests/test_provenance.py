"""Provenance: the id scheme, inline resolution, and the PROV-O rendering.

Like the other route tests these run without a database: the AGE store and the
provenance reader are both stubbed, so what is pinned is the contract — which
ids get picked out of a result set, what a citation looks like, how a missing
id or an unreachable store is reported, and that the RDF rendering is real RDF.
"""

from __future__ import annotations

from typing import Any

import pytest

# 同目录的姊妹测试模块（无 __init__.py，pytest 会把 tests/ 放进 sys.path）。
from conftest import TEST_API_TOKEN
from fastapi.testclient import TestClient
from test_query import StubStore, build_client, rows_store

from semantica_service import main
from semantica_service.config import Settings
from semantica_service.provenance import (
    ProvenanceReader,
    ProvenanceRecord,
    Resolution,
    collect_provenance_ids,
    interaction_prov_id,
    is_provenance_id,
    target_edge_prov_id,
    to_turtle,
)

EDGE_ID = "lucent:drugbank_drugs/DB00682/drug_interactions/DB00945"


@pytest.fixture
def settings() -> Settings:
    return Settings(neo4j_database="neo4j", api_token=TEST_API_TOKEN)


def record(entity_id: str = EDGE_ID, **overrides: Any) -> ProvenanceRecord:
    values: dict[str, Any] = {
        "id": entity_id,
        "entity_type": "graph_assertion",
        "source_document": "lucent.drugbank_drugs.drug_interactions",
        "source_location": "drugbank_id=DB00682, drugbankId=DB00945",
        "source_quote": "The risk or severity of bleeding can be increased.",
        "activity_id": "lucent:ingest/drugbank_xml@2026-03-05",
        "agent_id": "drugbank:full database.xml@2026-03-05",
        "agent_type": "source_dataset",
        "role": "derived",
        "confidence": 1.0,
        "timestamp": "2026-09-19T13:00:00+00:00",
        "sequence_id": 42,
        "checksum": "checksum-42",
        "parent_entity_id": None,
        "metadata": {"edge_type": "INTERACTS_WITH", "subject": "DB00682", "object": "DB00945"},
    }
    values.update(overrides)
    return ProvenanceRecord(**values)


class StubReader:
    """A provenance reader with scripted contents."""

    def __init__(
        self,
        records: list[ProvenanceRecord] | None = None,
        *,
        error: str | None = None,
        lineage: list[ProvenanceRecord] | None = None,
        chain: dict[str, Any] | None = None,
    ) -> None:
        self._records = records or []
        self._error = error
        self._lineage = lineage or []
        self._chain = chain or {
            "available": True,
            "error": None,
            "valid": True,
            "total_entries": 3,
            "broken_links": [],
        }
        self.resolved: list[list[str]] = []

    def resolve(self, ids: list[str]) -> Resolution:
        self.resolved.append(list(ids))
        if self._error is not None:
            return Resolution(records=[], missing=[], error=self._error)
        present = {item.id: item for item in self._records}
        found = [present[item] for item in ids if item in present]
        return Resolution(
            records=found,
            missing=[item for item in ids if item not in present],
        )

    def lineage(self, entity_id: str, max_depth: int = 4) -> list[ProvenanceRecord]:
        return list(self._lineage)

    def verify_chain(self) -> dict[str, Any]:
        return self._chain

    def close(self) -> None:
        pass


def build_provenance_client(
    monkeypatch: pytest.MonkeyPatch,
    store: StubStore,
    settings: Settings,
    reader: StubReader,
) -> TestClient:
    monkeypatch.setattr(main, "ProvenanceReader", lambda _settings: reader)
    return build_client(monkeypatch, store, settings)


# --- the id scheme ---------------------------------------------------------


def test_ids_are_readable_and_namespaced() -> None:
    assert interaction_prov_id("DB00682", "DB00945") == (
        "lucent:drugbank_drugs/DB00682/drug_interactions/DB00945"
    )
    assert target_edge_prov_id("DB00682", "abc", "enzyme", "INHIBITS") == (
        "lucent:drugbank_drug_targets/DB00682/abc/enzyme/INHIBITS"
    )
    assert is_provenance_id(interaction_prov_id("A", "B"))
    assert not is_provenance_id("drugbank_drugs/drug_interactions")


def test_collects_ids_from_flat_and_nested_values() -> None:
    rows: list[dict[str, Any]] = [
        # 列被别名过、或整条关系被返回（AGE 会嵌套 properties），两种都要认出来。
        {"drug": "Warfarin", "prov": EDGE_ID},
        {"r": {"type": "INTERACTS_WITH", "properties": {"prov": EDGE_ID}}},
        {"drug": "Aspirin", "note": "no provenance here"},
    ]
    ids, truncated = collect_provenance_ids(rows, 10)
    assert ids == [EDGE_ID]
    assert truncated is False


def test_reports_truncation_rather_than_a_complete_looking_list() -> None:
    rows = [{"prov": f"lucent:drugbank_drugs/D{i:05d}/drug_interactions/D00001"} for i in range(5)]
    ids, truncated = collect_provenance_ids(rows, 3)
    assert len(ids) == 3
    assert truncated is True


# --- /query inline resolution ---------------------------------------------


def test_query_resolves_ids_into_citations(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([{"drug": "Warfarin", "prov": EDGE_ID}], keys=["drug", "prov"])
    reader = StubReader([record()])
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post(
            "/query",
            json={"cypher": "MATCH (a)-[r]->(b) RETURN r.prov AS prov LIMIT 5"},
        )

    assert response.status_code == 200
    body = response.json()
    assert reader.resolved == [[EDGE_ID]]
    assert body["provenance_missing"] == []
    assert body["provenance_error"] is None
    [citation] = body["provenance"]
    assert citation["id"] == EDGE_ID
    assert citation["source_document"] == "lucent.drugbank_drugs.drug_interactions"
    assert citation["source_location"] == "drugbank_id=DB00682, drugbankId=DB00945"
    assert citation["sequence_id"] == 42
    assert citation["checksum"] == "checksum-42"


def test_query_can_skip_provenance(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    store = rows_store([{"prov": EDGE_ID}], keys=["prov"])
    reader = StubReader([record()])
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post(
            "/query",
            json={
                "cypher": "MATCH (a)-[r]->(b) RETURN r.prov AS prov LIMIT 5",
                "include_provenance": False,
            },
        )

    assert response.status_code == 200
    assert response.json()["provenance"] == []
    assert reader.resolved == []


def test_query_reports_an_unreachable_store_separately_from_missing_ids(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([{"prov": EDGE_ID}], keys=["prov"])
    reader = StubReader(error="provenance store unavailable: connection refused")
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post(
            "/query", json={"cypher": "MATCH (a)-[r]->(b) RETURN r.prov AS prov LIMIT 5"}
        )

    body = response.json()
    assert body["provenance"] == []
    assert body["provenance_error"] == "provenance store unavailable: connection refused"
    # 没有库可问，与"这些 id 不在库里"是两件事，不能混成一个空列表。
    assert body["provenance_missing"] == []


def test_query_reports_ids_the_store_does_not_hold(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    other = interaction_prov_id("DB00004", "DB14766")
    store = rows_store([{"prov": EDGE_ID}, {"prov": other}], keys=["prov"])
    reader = StubReader([record()])
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post(
            "/query", json={"cypher": "MATCH (a)-[r]->(b) RETURN r.prov AS prov LIMIT 5"}
        )

    body = response.json()
    assert [citation["id"] for citation in body["provenance"]] == [EDGE_ID]
    assert body["provenance_missing"] == [other]


# --- /provenance -----------------------------------------------------------


def test_provenance_returns_records_lineage_and_chain(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    row_id = "lucent:drugbank_drug_targets/DB00682/abc/enzyme"
    store = rows_store([])
    reader = StubReader(
        [record()],
        lineage=[record(row_id, entity_type="source_row", parent_entity_id=None)],
    )
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post("/provenance", json={"ids": [EDGE_ID], "lineage": True})

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["records"]] == [EDGE_ID]
    assert [item["id"] for item in body["lineage"]] == [row_id]
    assert body["chain"]["valid"] is True
    assert body["chain"]["total_entries"] == 3
    assert body["provo"] is None


def test_provenance_renders_prov_o(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    store = rows_store([])
    reader = StubReader([record()])
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        turtle = client.post("/provenance", json={"ids": [EDGE_ID], "format": "turtle"})
        jsonld = client.post("/provenance", json={"ids": [EDGE_ID], "format": "jsonld"})

    assert turtle.status_code == 200
    document = turtle.json()["provo"]
    assert "prov:wasGeneratedBy" in document
    assert "prov:wasDerivedFrom" in document
    assert "source_dataset" in document

    # JSON-LD 是同一张图的另一次序列化，不是另一份实现。
    parsed = jsonld.json()["provo"]
    assert isinstance(parsed, (list, dict))
    assert EDGE_ID in jsonld.text


def test_provenance_reports_a_missing_id(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([])
    reader = StubReader([])
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.post("/provenance", json={"ids": [EDGE_ID]})

    body = response.json()
    assert body["records"] == []
    assert body["missing"] == [EDGE_ID]


def test_verify_route_returns_the_chain_report(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = rows_store([])
    reader = StubReader(
        chain={
            "available": True,
            "error": None,
            "valid": False,
            "total_entries": 10,
            "broken_links": [{"entity_id": "x", "sequence_id": 7, "reason": "checksum_mismatch"}],
        }
    )
    with build_provenance_client(monkeypatch, store, settings, reader) as client:
        response = client.get("/provenance/verify")

    body = response.json()
    assert body["valid"] is False
    assert body["broken_links"][0]["reason"] == "checksum_mismatch"


def test_proven_o_turtle_is_parseable_rdf() -> None:
    """The PROV-O claim is checked by an RDF parser, not by string matching."""
    from rdflib import Graph, Namespace
    from rdflib.namespace import RDF

    PROV = Namespace("http://www.w3.org/ns/prov#")
    graph = Graph()
    graph.parse(data=to_turtle([record()]), format="turtle")

    entity = next(graph.subjects(RDF.type, PROV.Entity))
    assert (entity, PROV.wasGeneratedBy, None) in graph
    assert (entity, PROV.wasAttributedTo, None) in graph
    assert (entity, PROV.wasDerivedFrom, None) in graph


def test_reader_without_a_store_reports_unavailable() -> None:
    """A deployment whose provenance store is missing must degrade, not crash."""
    reader = ProvenanceReader(Settings(provenance_dsn="host=127.0.0.1 port=1 dbname=none"))
    resolution = reader.resolve([EDGE_ID])
    assert resolution.available is False
    assert resolution.error is not None
    # 记住失败而不是每次请求都重连一遍。
    assert reader.resolve([EDGE_ID]).error == resolution.error

"""Attach PROV-O provenance to every edge of the pilot graph.

Building the graph was a deterministic schema mapping (``load_graph.py``), so
every edge is a function of exactly one source row. This script records that
fact in two places, both derived from the same deterministic id:

*graph pass*
    writes the id onto the edge as ``r.prov``, so any Cypher that returns a
    relationship can carry the reference of the assertion it came from —
    ``RETURN d.name, p.name, r.prov AS prov``. Nothing is invented here: the id
    is computed from the edge's own endpoints and type.

*store pass*
    writes one PROV entry per edge into the Postgres provenance store
    (hash-chained, so the audit trail is tamper-evident), plus one entry per
    drug->target source row — the row is the entity the verb edges derive from,
    which gives ``trace_lineage`` a real two-level chain — plus one entry per
    ingest activity, carrying the source file and export date.

Id scheme (readable, resolvable without a lookup, and the same string in both
places)::

    lucent:drugbank_drugs/DB00004/drug_interactions/DB14766
        one entry of that drug's interaction list      -> INTERACTS_WITH edge
    lucent:drugbank_drugs/DB00004/atc_codes/L01XX29    -> IN_ATC_CLASS edge
    lucent:drugbank_drug_targets/DB00004/<target>/enzyme
        one drug->target source row                    -> the row entity
    lucent:drugbank_drug_targets/DB00004/<target>/enzyme/INHIBITS
        one recognised action verb of that row         -> the edge
    lucent:derived/atc_hierarchy/L01X/L01XX29
        a class link materialised from ATC prefixes    -> SUBCLASS_OF edge
    lucent:ingest/<source_key>@<export date>           -> the ingest activity

Confidence is 1.0 throughout: these are structured fields read by a mapping, not
extractions with an error model. The nuances that do exist (``known_action``,
which verb was recognised) live in ``metadata`` rather than being folded into a
number that would imply a precision the source does not have.

    uv run python scripts/add_edge_provenance.py            # graph + store + verify
    uv run python scripts/add_edge_provenance.py --graph    # ids onto the edges only
    uv run python scripts/add_edge_provenance.py --store    # store pass only
    uv run python scripts/add_edge_provenance.py --verify   # checks only
    uv run python scripts/add_edge_provenance.py --reset    # wipe the store first
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
from semantica.graph_store.age_store import ApacheAgeStore
from semantica.provenance import PostgresStorage, ProvenanceManager

from semantica_service.config import get_settings
from semantica_service.provenance.ids import (
    PREFIX,
    activity_prov_id,
    atc_prov_id,
    interaction_prov_id,
    materialise_activity_prov_id,
    subclass_prov_id,
    target_edge_prov_id,
    target_row_prov_id,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_subgraph import ANCHORS, SCOPE_PREFIXES  # noqa: E402
from load_graph import ACTION_EDGE, KIND_EDGE, atc_parent  # noqa: E402

# Every relationship type a drug->target row can produce, derived from the same
# mapping the load used rather than a hand-written list that could drift.
TARGET_VERBS: list[str] = sorted({*ACTION_EDGE.values(), *KIND_EDGE.values()})

INTERACTION_SOURCE = "lucent.drugbank_drugs.drug_interactions"
TARGET_SOURCE = "lucent.drugbank_drug_targets"
ATC_SOURCE = "lucent.drugbank_drugs.atc_codes"
HIERARCHY_SOURCE = "derived.lucent_graph.atc_hierarchy"


# --------------------------------------------------------------------------
# Rows to record
# --------------------------------------------------------------------------


@dataclass
class ProvRow:
    """One provenance entry to write, plus the columns it resolves back to."""

    entity_id: str
    entity_type: str
    source_document: str
    source_location: str
    source_quote: str
    activity_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    parent_entity_id: str | None = None


@dataclass(frozen=True)
class ImportMeta:
    """The `drug_source_imports` row that produced the DrugBank tables."""

    source_key: str
    source_name: str
    source_file_name: str
    source_exported_at: str
    imported_row_count: int
    import_row_id: str

    @property
    def export_date(self) -> str:
        return self.source_exported_at[:10]

    @property
    def agent_id(self) -> str:
        """The dataset as the PROV agent: its file and export date."""
        return f"drugbank:{self.source_file_name}@{self.export_date}"


def scope_cte() -> str:
    """The ATC-plus-anchor scope, reused from the export script.

    Reading every interaction row and discarding the out-of-scope ones would be
    ~2.5M rows for 200k kept; scoping in SQL keeps the read proportional to the
    graph.
    """
    return """
        WITH sel_drugs AS (
            SELECT DISTINCT d.drugbank_id
            FROM drugbank_drugs d
            WHERE EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(d.atc_codes) c
                    WHERE left(c, 4) = ANY(%(prefixes)s)
                  )
               OR d.name = ANY(%(anchors)s)
        )
    """


def read_import_meta(cur: Any) -> ImportMeta:
    """The completed DrugBank XML import: file name, export date, run id."""
    cur.execute(
        """
        SELECT id, source_key, source_name,
               coalesce(source_file_name, '') AS source_file_name,
               coalesce(source_exported_at::text, '') AS source_exported_at,
               coalesce(imported_row_count, 0) AS imported_row_count
        FROM drug_source_imports
        WHERE source_key = 'drugbank_drugs' AND status = 'completed'
        ORDER BY imported_row_count DESC, created_at DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if row is None:
        raise RuntimeError("no completed drugbank_drugs import found")
    return ImportMeta(
        import_row_id=row["id"],
        source_key=row["source_key"],
        source_name=row["source_name"],
        source_file_name=row["source_file_name"],
        source_exported_at=row["source_exported_at"],
        imported_row_count=int(row["imported_row_count"]),
    )


def _server_cursor(conn: Any, query: str, params: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Stream a query rather than materialising 200k rows with their prose."""
    name = f"prov_{abs(hash(query)) % 10**8}"
    with conn.cursor(name=name, cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.itersize = 5000
        cur.execute(query, params)
        yield from cur


def iter_prov_rows(conn: Any, meta: ImportMeta) -> Iterator[ProvRow]:
    """Yield every row the graph's edges are derived from, in id order.

    Order is what the hash chain follows, so it is fixed by the id (which is
    itself derived from the source keys) rather than by database row order.
    """
    params = {"prefixes": list(SCOPE_PREFIXES), "anchors": ANCHORS}
    cte = scope_cte()
    base_metadata = {
        "source_name": meta.source_name,
        "source_file_name": meta.source_file_name,
        "source_exported_at": meta.source_exported_at,
        "import_row_id": meta.import_row_id,
    }

    interaction_activity = activity_prov_id("drugbank_xml", meta.export_date)
    atc_activity = interaction_activity

    # --- drug -> drug interactions ---
    # Both sides must be in scope, exactly as the export cut them: the graph
    # holds an INTERACTS_WITH edge only when the counterparty was exported too,
    # and a run that forgot this stored 742k entries for 200k edges.
    for row in _server_cursor(
        conn,
        cte
        + """
        SELECT d.drugbank_id AS drug, e->>'drugbankId' AS other,
               coalesce(e->>'name', '') AS other_name,
               coalesce(e->>'description', '') AS description
        FROM drugbank_drugs d, jsonb_array_elements(d.drug_interactions) e
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
          AND e->>'drugbankId' IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY 1, 2
        """,
        params,
    ):
        yield ProvRow(
            entity_id=interaction_prov_id(row["drug"], row["other"]),
            entity_type="graph_assertion",
            source_document=INTERACTION_SOURCE,
            source_location=f"drugbank_id={row['drug']}, drugbankId={row['other']}",
            source_quote=row["description"],
            activity_id=interaction_activity,
            metadata={
                **base_metadata,
                "edge_type": "INTERACTS_WITH",
                "subject": row["drug"],
                "object": row["other"],
                "object_name": row["other_name"],
            },
        )

    # --- drug -> target rows, and the verb edge each recognised action makes ---
    for row in _server_cursor(
        conn,
        cte
        + """
        SELECT t.drugbank_id AS drug, t.target_id AS target,
               coalesce(t.relation_kind, '') AS relation_kind,
               coalesce(t.known_action, '') AS known_action,
               t.actions AS actions
        FROM drugbank_drug_targets t
        WHERE t.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY 1, 2, 3
        """,
        params,
    ):
        relation_kind = row["relation_kind"]
        actions = [str(action) for action in (row["actions"] or [])]
        row_id = target_row_prov_id(row["drug"], row["target"], relation_kind)
        yield ProvRow(
            entity_id=row_id,
            entity_type="source_row",
            source_document=TARGET_SOURCE,
            source_location=(
                f"drugbank_id={row['drug']}, target_id={row['target']}, "
                f"relation_kind={relation_kind}"
            ),
            source_quote=f"relation_kind={relation_kind}; actions={actions}; "
            f"known_action={row['known_action']}",
            activity_id=interaction_activity,
            metadata={
                **base_metadata,
                "subject": row["drug"],
                "object": row["target"],
                "relation_kind": relation_kind,
                "actions": actions,
                "known_action": row["known_action"],
            },
        )
        for rel_type in recognised_verbs(relation_kind, actions):
            yield ProvRow(
                entity_id=target_edge_prov_id(row["drug"], row["target"], relation_kind, rel_type),
                entity_type="graph_assertion",
                source_document=TARGET_SOURCE,
                source_location=(
                    f"drugbank_id={row['drug']}, target_id={row['target']}, "
                    f"relation_kind={relation_kind}"
                ),
                source_quote=f"{rel_type} recognised from actions={actions} "
                f"(known_action={row['known_action']})",
                activity_id=interaction_activity,
                parent_entity_id=row_id,
                metadata={
                    **base_metadata,
                    "edge_type": rel_type,
                    "subject": row["drug"],
                    "object": row["target"],
                    "relation_kind": relation_kind,
                    "actions": actions,
                    "known_action": row["known_action"],
                },
            )

    # --- drug -> ATC ---
    for row in _server_cursor(
        conn,
        cte
        + """
        SELECT d.drugbank_id AS drug, c AS code
        FROM drugbank_drugs d, jsonb_array_elements_text(d.atc_codes) c
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        ORDER BY 1, 2
        """,
        params,
    ):
        yield ProvRow(
            entity_id=atc_prov_id(row["drug"], row["code"]),
            entity_type="graph_assertion",
            source_document=ATC_SOURCE,
            source_location=f"drugbank_id={row['drug']}, code={row['code']}",
            source_quote=row["code"],
            activity_id=atc_activity,
            metadata={
                **base_metadata,
                "edge_type": "IN_ATC_CLASS",
                "subject": row["drug"],
                "object": row["code"],
            },
        )

    # --- the ATC hierarchy, materialised from those codes ---
    codes = collect_atc_codes(conn, params)
    materialise_activity = materialise_activity_prov_id(meta.export_date)
    for child in sorted(codes):
        parent = atc_parent(child)
        if parent is None or parent not in codes:
            continue
        yield ProvRow(
            entity_id=subclass_prov_id(parent, child),
            entity_type="graph_assertion",
            source_document=HIERARCHY_SOURCE,
            source_location=f"parent={parent}, child={child}",
            source_quote=f"{parent} -> {child}",
            activity_id=materialise_activity,
            metadata={
                "edge_type": "SUBCLASS_OF",
                "subject": parent,
                "object": child,
                "derived_from": ATC_SOURCE,
                "derivation": "ATC level prefix materialisation (load_graph.atc_parent)",
            },
        )


def collect_atc_codes(conn: Any, params: dict[str, Any]) -> set[str]:
    """Every ATC code and ancestor prefix the loaded graph contains.

    Matches how the loader materialised the class nodes: for each drug code,
    the prefixes at the levels ATC actually has nodes at (1, 3, 4, 5, 7).
    """
    codes: set[str] = set()
    for row in _server_cursor(
        conn,
        scope_cte()
        + """
        SELECT DISTINCT c AS code
        FROM drugbank_drugs d, jsonb_array_elements_text(d.atc_codes) c
        WHERE d.drugbank_id IN (SELECT drugbank_id FROM sel_drugs)
        """,
        params,
    ):
        code = row["code"]
        for depth in (1, 3, 4, 5, 7):
            prefix = code[:depth]
            if len(prefix) >= 3:
                codes.add(prefix)
    return codes


def recognised_verbs(relation_kind: str, actions: list[str]) -> list[str]:
    """The verb edges one source row produces, exactly as the loader derived them."""
    verbs = [
        ACTION_EDGE[(relation_kind, verb)]
        for verb in actions
        if (relation_kind, verb) in ACTION_EDGE
    ]
    if verbs:
        return sorted(set(verbs))
    return [KIND_EDGE.get(relation_kind, "ACTS_ON")]


def activity_rows(meta: ImportMeta) -> list[ProvRow]:
    """The ingest activities themselves, so an assertion can name its activity."""
    export_date = meta.export_date
    agent_provenance = {
        "source_name": meta.source_name,
        "source_file_name": meta.source_file_name,
        "source_exported_at": meta.source_exported_at,
        "import_row_id": meta.import_row_id,
        "imported_row_count": meta.imported_row_count,
    }
    return [
        ProvRow(
            entity_id=activity_prov_id("drugbank_xml", export_date),
            entity_type="ingest_activity",
            source_document="lucent.drug_source_imports",
            source_location=f"id={meta.import_row_id}",
            source_quote=(
                f"{meta.source_name} ({meta.source_file_name}) exported "
                f"{meta.source_exported_at}; {meta.imported_row_count} source rows"
            ),
            activity_id=activity_prov_id("drugbank_xml", export_date),
            metadata={
                **agent_provenance,
                "tables": [
                    "drugbank_drugs",
                    "drugbank_drugs.drug_interactions",
                    "drugbank_drugs.atc_codes",
                    "drugbank_drug_targets",
                ],
            },
        ),
        ProvRow(
            entity_id=materialise_activity_prov_id(export_date),
            entity_type="ingest_activity",
            source_document="lucent_graph.load_graph",
            source_location="scripts/load_graph.py",
            source_quote=(
                "ATC class nodes and SUBCLASS_OF edges materialised from ATC code "
                "prefixes; no source row asserts them directly"
            ),
            activity_id=materialise_activity_prov_id(export_date),
            metadata={"derived_from": ATC_SOURCE, "tables": ["drugbank_drugs.atc_codes"]},
        ),
    ]


# --------------------------------------------------------------------------
# Graph pass
# --------------------------------------------------------------------------


def graph_statements() -> list[tuple[str, str]]:
    """(relationship type, `SET` expression) pairs, one statement per type.

    The expression mirrors the Python id functions exactly. The type is a
    literal rather than ``type(r)`` so the statement stays explicit about what
    it is writing, and the endpoint labels are spelled out because AGE's subset
    has no multi-label match.
    """
    statements = [
        (
            "INTERACTS_WITH",
            f"'{PREFIX}drugbank_drugs/' + a.drugbank_id + '/drug_interactions/' + b.drugbank_id",
        ),
        (
            "IN_ATC_CLASS",
            f"'{PREFIX}drugbank_drugs/' + a.drugbank_id + '/atc_codes/' + b.code",
        ),
        (
            "SUBCLASS_OF",
            f"'{PREFIX}derived/atc_hierarchy/' + a.code + '/' + b.code",
        ),
    ]
    statements += [
        (
            rel_type,
            f"'{PREFIX}drugbank_drug_targets/' + a.drugbank_id + '/' + b.id + "
            f"'/' + r.relation_kind + '/{rel_type}'",
        )
        for rel_type in TARGET_VERBS
    ]
    return statements


def match_pattern(rel_type: str) -> str:
    """The endpoint labels for a relationship type, as the load created them."""
    if rel_type == "INTERACTS_WITH":
        return f"(a:Drug)-[r:{rel_type}]->(b:Drug)"
    if rel_type == "IN_ATC_CLASS":
        return f"(a:Drug)-[r:{rel_type}]->(b:ATCClass)"
    if rel_type == "SUBCLASS_OF":
        return f"(a:ATCClass)-[r:{rel_type}]->(b:ATCClass)"
    return f"(a:Drug)-[r:{rel_type}]->(b:Protein)"


def run_graph_pass(store: ApacheAgeStore) -> None:
    """Write the provenance id onto every edge, one statement per type."""
    print("== graph pass: prov ids onto the edges ==")
    started = time.perf_counter()
    for rel_type, expression in graph_statements():
        query = f"MATCH {match_pattern(rel_type)} SET r.prov = {expression} RETURN count(r) AS n"
        try:
            result = store.execute_query(query)
        except Exception as exc:  # noqa: BLE001 - one bad type must not hide the rest
            print(f"  {rel_type:20} FAILED: {type(exc).__name__}: {exc}")
            continue
        count = int(result["records"][0]["n"]) if result.get("records") else 0
        if count:
            print(f"  {rel_type:20} {count}")
    print(f"  done in {time.perf_counter() - started:.1f}s")


# --------------------------------------------------------------------------
# Store pass
# --------------------------------------------------------------------------


def store_ids(dsn: str, table: str) -> set[str]:
    """Every id the store holds, read as ids rather than as full entries.

    ``retrieve_all()`` would build 200k+ ProvenanceEntry objects — their whole
    39-field payload — to answer a question about a single column. Ids are also
    all this script needs, for the skip decision and for the agreement check.
    """
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT entity_id FROM {table}")
        return {str(row[0]) for row in cur.fetchall()}


def read_chain_head(dsn: str, table: str) -> tuple[int, str | None]:
    """``(sequence_id, checksum)`` of the newest entry, or ``(0, None)``."""
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT sequence_id, checksum FROM {table} "
            "ORDER BY sequence_id DESC NULLS LAST LIMIT 1"
        )
        row = cur.fetchone()
    if row is None or row[0] is None:
        return 0, None
    return int(row[0]), str(row[1])


def build_entries(
    pending: list[ProvRow], meta: ImportMeta, head: tuple[int, str | None]
) -> list[Any]:
    """Build the chain: sequence numbers, previous checksums, checksums.

    This is the same arithmetic ``ProvenanceManager._save_entry`` performs —
    read the head, link to it, hash the entry — done here in one pass instead of
    one round trip per row. The manager's per-row path costs ~3 queries per
    entry, which on 210k entries is an hour of local round trips for a write
    that fits in a few minutes in bulk. What makes that trade safe is not the
    equivalence of the two code paths but ``verify_chain``: it re-derives every
    checksum and every link from the stored payloads afterwards, so a chain
    written here is checked, not trusted.
    """
    from semantica.provenance import ProvenanceEntry, compute_checksum
    from semantica.utils.helpers import utc_now_iso

    entries: list[Any] = []
    sequence, previous = head
    for row in pending:
        now = utc_now_iso()
        entry = ProvenanceEntry(
            entity_id=row.entity_id,
            entity_type=row.entity_type,
            activity_id=row.activity_id,
            agent_id=meta.agent_id,
            agent_type="source_dataset",
            is_automated=True,
            role="derived",
            source_document=row.source_document,
            source_location=row.source_location,
            source_quote=row.source_quote,
            confidence=1.0,
            metadata=row.metadata,
            first_seen=now,
            last_updated=now,
            parent_entity_id=row.parent_entity_id,
        )
        sequence += 1
        entry.sequence_id = sequence
        entry.previous_checksum = previous
        entry.checksum = compute_checksum(entry)
        previous = entry.checksum
        entries.append(entry)
    return entries


def insert_entries(entries: list[Any], *, dsn: str, table: str, batch_size: int) -> int:
    """Insert pre-built entries in batches, upserting on id like the backend."""
    import psycopg2.extras

    statement = f"""
        INSERT INTO {table}
            (entity_id, entity_type, sequence_id, checksum,
             previous_checksum, parent_entity_id, timestamp, payload)
        VALUES %s
        ON CONFLICT (entity_id) DO UPDATE SET
            entity_type       = EXCLUDED.entity_type,
            sequence_id       = EXCLUDED.sequence_id,
            checksum          = EXCLUDED.checksum,
            previous_checksum = EXCLUDED.previous_checksum,
            parent_entity_id  = EXCLUDED.parent_entity_id,
            timestamp         = EXCLUDED.timestamp,
            payload           = EXCLUDED.payload
    """
    written = 0
    started = time.perf_counter()
    with psycopg2.connect(dsn) as conn:
        for start in range(0, len(entries), batch_size):
            chunk = entries[start : start + batch_size]
            values = [
                (
                    entry.entity_id,
                    entry.entity_type,
                    entry.sequence_id,
                    entry.checksum,
                    entry.previous_checksum,
                    entry.parent_entity_id,
                    entry.timestamp,
                    json.dumps(entry.to_dict(), ensure_ascii=False, default=str),
                )
                for entry in chunk
            ]
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, statement, values, page_size=500)
            conn.commit()
            written += len(chunk)
            elapsed = time.perf_counter() - started
            print(
                f"  {written}/{len(entries)} written ({written / elapsed:.0f}/s, {elapsed:.0f}s)",
                end="\r",
                flush=True,
            )
    print()
    return written


def run_store_pass(
    manager: ProvenanceManager,
    rows: list[ProvRow],
    meta: ImportMeta,
    *,
    reset: bool,
    batch_size: int,
    dsn: str,
    table: str,
) -> int:
    """Write the entries, skipping ids already present so a re-run is a no-op.

    Skipping matters for more than speed: a second write of the same id would
    take a new slot in the chain and strand the first one, which ``verify_chain``
    would then report as a gap.
    """
    if reset:
        removed = manager.clear()
        print(f"  reset: cleared {removed} entries")

    existing = store_ids(dsn, table)
    print(f"  store already holds {len(existing)} entries")

    queue = [*activity_rows(meta), *rows]
    pending = [row for row in queue if row.entity_id not in existing]
    print(f"  {len(queue)} rows, {len(pending)} to write")

    head = read_chain_head(dsn, table)
    print(f"  chain head: sequence {head[0]}")
    entries = build_entries(pending, meta, head)
    return insert_entries(entries, dsn=dsn, table=table, batch_size=batch_size)


def run_store_pass_via_manager(
    storage: PostgresStorage,
    manager: ProvenanceManager,
    rows: list[ProvRow],
    meta: ImportMeta,
    *,
    batch_size: int,
) -> int:
    """The library's own per-row writer: the reference path, kept runnable.

    Used to prove the bulk path writes the same shape (a run of this followed by
    ``--verify`` shows one chain spanning both writers), and as the fallback if
    the storage backend ever changes what a row means.
    """
    written = 0
    started = time.perf_counter()
    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        with storage.transaction() as conn:
            for row in chunk:
                manager.track_entity(
                    row.entity_id,
                    row.source_document,
                    row.metadata,
                    _conn=conn,
                    entity_type=row.entity_type,
                    activity_id=row.activity_id,
                    agent_id=meta.agent_id,
                    agent_type="source_dataset",
                    is_automated=True,
                    role="derived",
                    source_location=row.source_location,
                    source_quote=row.source_quote,
                    parent_entity_id=row.parent_entity_id,
                    confidence=1.0,
                )
                written += 1
        done = min(start + batch_size, len(rows))
        elapsed = time.perf_counter() - started
        rate = written / elapsed if elapsed else 0
        print(
            f"  {done}/{len(rows)} written ({rate:.0f}/s, {elapsed:.0f}s)",
            end="\r",
            flush=True,
        )
    print()
    return written


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------


def graph_ids(store: ApacheAgeStore) -> set[str]:
    """Every provenance id currently written on an edge."""
    ids: set[str] = set()
    for rel_type, _ in graph_statements():
        result = store.execute_query(f"MATCH {match_pattern(rel_type)} RETURN r.prov AS prov")
        for record in result.get("records", []):
            value = record.get("prov")
            if value:
                ids.add(str(value))
    return ids


def run_verify(
    store: ApacheAgeStore,
    manager: ProvenanceManager,
    rows: list[ProvRow],
    *,
    dsn: str,
    table: str,
) -> dict[str, Any]:
    """Check that both halves agree, and that the audit chain is intact."""
    report: dict[str, Any] = {}

    print("== verify: every edge carries an id ==")
    nulls: dict[str, int] = {}
    for rel_type, _ in graph_statements():
        result = store.execute_query(
            f"MATCH {match_pattern(rel_type)} WHERE r.prov IS NULL RETURN count(r) AS n"
        )
        count = int(result["records"][0]["n"]) if result.get("records") else 0
        if count:
            nulls[rel_type] = count
    report["edges_without_id"] = nulls
    print(f"  edges without an id: {sum(nulls.values())} {nulls or ''}")

    print("== verify: graph ids all resolve in the store ==")
    on_graph = graph_ids(store)
    in_store = store_ids(dsn, table)
    unresolved = sorted(on_graph - in_store)
    report["graph_ids"] = len(on_graph)
    report["store_ids"] = len(in_store)
    report["unresolved"] = unresolved[:20]
    report["unresolved_count"] = len(unresolved)
    print(
        f"  graph ids: {len(on_graph)}, store ids: {len(in_store)}, unresolved: {len(unresolved)}"
    )
    if unresolved:
        for sample in unresolved[:5]:
            print(f"    missing: {sample}")

    print("== verify: store holds nothing the graph lacks ==")
    # `rows` is the full write queue, activities included: an activity id is
    # expected to be in the store without being an edge.
    expected_parents = {row.entity_id for row in rows if row.entity_type == "source_row"}
    expected_activities = {row.entity_id for row in rows if row.entity_type == "ingest_activity"}
    extra = in_store - on_graph - expected_parents - expected_activities
    report["extra"] = sorted(extra)[:20]
    report["extra_count"] = len(extra)
    print(f"  unexplained extra ids: {len(extra)}")

    print("== verify: hash chain ==")
    chain = manager.verify_chain()
    report["chain"] = {
        "valid": chain.get("valid"),
        "total_entries": chain.get("total_entries"),
        "broken_links": len(chain.get("broken_links") or []),
    }
    print(f"  {report['chain']}")

    return report


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", action="store_true", help="Run the graph pass.")
    parser.add_argument("--store", action="store_true", help="Run the store pass.")
    parser.add_argument("--verify", action="store_true", help="Run the checks.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear the provenance table before the store pass.",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=2000,
        help="Entries per transaction in the store pass.",
    )
    parser.add_argument(
        "--via-manager",
        action="store_true",
        help=(
            "Write through semantica's own per-row writer instead of the bulk "
            "path (~100 entries/s against ~5k/s, same chain)."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    # No flag means the full run; any flag means only what was asked for.
    run_graph = args.graph or not (args.graph or args.store or args.verify)
    run_store = args.store or not (args.graph or args.store or args.verify)
    run_checks = args.verify or not (args.graph or args.store or args.verify)

    settings = get_settings()
    store = ApacheAgeStore(connection_string=settings.age_dsn, graph_name=settings.graph_name)
    store.connect()

    if run_graph:
        run_graph_pass(store)

    storage = PostgresStorage(
        connection_string=settings.provenance_dsn,
        table=settings.provenance_table,
    )
    manager = ProvenanceManager(storage=storage)

    if run_store or run_checks:
        conn = psycopg2.connect(settings.source_dsn)
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            meta = read_import_meta(cur)
            print(f"== source: {meta.source_file_name} exported {meta.source_exported_at}")
            print("== reading source rows ==")
            started = time.perf_counter()
            rows = list(iter_prov_rows(conn, meta))
            print(f"  {len(rows)} rows in {time.perf_counter() - started:.1f}s")
        finally:
            conn.close()

    if run_store:
        print("== store pass: PROV entries ==")
        if args.via_manager:
            written = run_store_pass_via_manager(
                storage, manager, rows, meta, batch_size=args.batch
            )
        else:
            written = run_store_pass(
                manager,
                rows,
                meta,
                reset=args.reset,
                batch_size=args.batch,
                dsn=settings.provenance_dsn,
                table=settings.provenance_table,
            )
        print(f"  wrote {written} entries")

    if run_checks:
        run_verify(
            store,
            manager,
            [*activity_rows(meta), *rows],
            dsn=settings.provenance_dsn,
            table=settings.provenance_table,
        )

    storage.close()
    store.close()


if __name__ == "__main__":
    main()

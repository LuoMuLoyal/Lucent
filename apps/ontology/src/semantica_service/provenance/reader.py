"""Read side of the hash-chained provenance store.

The store is written once, at import time, by ``scripts/add_edge_provenance.py``
and is never touched by a request: an audit trail a request can append to is not
a record of what the import did. What a request needs is *resolution* — a Cypher
result carries provenance ids (``r.prov``) and the caller wants to know which
source row each one came from, and whether the chain behind them is intact.

The backend is semantica's own ``PostgresStorage`` (the fork's addition), so the
entry shape, the checksum chain and the verification routine are the library's
rather than a second implementation here.
"""

from __future__ import annotations

import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from semantica.provenance import PostgresStorage, ProvenanceManager

from ..config import Settings, get_settings


class ProvenanceUnavailable(RuntimeError):
    """The store cannot be reached, or the migration has not been run."""


@dataclass(frozen=True)
class ProvenanceRecord:
    """One citation: an assertion, and where it came from.

    A projection of semantica's 39-field entry onto the fields a citation can
    explain. Keeping the projection explicit is what stops this service's wire
    shape from following the library's.
    """

    id: str
    entity_type: str
    source_document: str
    source_location: str
    source_quote: str
    activity_id: str | None = None
    agent_id: str | None = None
    agent_type: str | None = None
    role: str | None = None
    confidence: float | None = None
    timestamp: str | None = None
    sequence_id: int | None = None
    checksum: str | None = None
    parent_entity_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_entry(cls, entry: Any) -> ProvenanceRecord:
        """Build a citation from a semantica ``ProvenanceEntry``."""
        confidence = getattr(entry, "confidence", None)
        sequence_id = getattr(entry, "sequence_id", None)
        return cls(
            id=str(entry.entity_id),
            entity_type=str(getattr(entry, "entity_type", "") or ""),
            source_document=str(getattr(entry, "source_document", "") or ""),
            source_location=str(getattr(entry, "source_location", "") or ""),
            source_quote=str(getattr(entry, "source_quote", "") or ""),
            activity_id=_optional_str(getattr(entry, "activity_id", None)),
            agent_id=_optional_str(getattr(entry, "agent_id", None)),
            agent_type=_optional_str(getattr(entry, "agent_type", None)),
            role=_optional_str(getattr(entry, "role", None)),
            confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
            timestamp=_optional_str(getattr(entry, "timestamp", None)),
            sequence_id=int(sequence_id) if isinstance(sequence_id, int) else None,
            checksum=_optional_str(getattr(entry, "checksum", None)),
            parent_entity_id=_optional_str(getattr(entry, "parent_entity_id", None)),
            metadata=dict(getattr(entry, "metadata", None) or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        """Wire shape, snake_case like every other response of this service.

        ``id`` is the reference a citation is quoted by; the rest is what the
        citation can explain.
        """
        return {
            "id": self.id,
            "entity_type": self.entity_type,
            "source_document": self.source_document,
            "source_location": self.source_location,
            "source_quote": self.source_quote,
            "activity_id": self.activity_id,
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "role": self.role,
            "confidence": self.confidence,
            "timestamp": self.timestamp,
            "sequence_id": self.sequence_id,
            "checksum": self.checksum,
            "parent_entity_id": self.parent_entity_id,
            "metadata": self.metadata,
        }


def _optional_str(value: object) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


@dataclass(frozen=True)
class Resolution:
    """Outcome of resolving a set of ids."""

    records: list[ProvenanceRecord]
    missing: list[str]
    #: Set when the store could not be read at all. Distinguishes "these ids
    #: are not in the store" from "there is no store to ask", which an empty
    #: record list alone cannot express.
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.error is None


class ProvenanceReader:
    """Lazy, thread-safe read access to the provenance store.

    The connection pool is opened on first use so a service instance whose
    provenance store has not been migrated yet still starts and still answers
    ``/query`` — it just reports that citations are unavailable instead of
    failing the request.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._backend_cached: tuple[PostgresStorage, ProvenanceManager] | None = None
        self._error: str | None = None
        self._lock = threading.Lock()

    # -- lifecycle ------------------------------------------------------

    def _backend(self) -> tuple[PostgresStorage, ProvenanceManager] | None:
        """Open the store once; remember the failure rather than retrying it."""
        if self._backend_cached is None and self._error is None:
            with self._lock:
                self._open()
        return self._backend_cached

    def _open(self) -> None:
        """Build the pool, unless that has already been decided.

        Kept separate from :meth:`_backend` so the double-checked locking stays
        readable as two steps: decide once, then open once.
        """
        if self._backend_cached is not None or self._error is not None:
            return
        try:
            storage = PostgresStorage(
                connection_string=self._settings.provenance_dsn,
                table=self._settings.provenance_table,
                # The service must not create the table: an audit trail that a
                # reading process can silently initialise is one whose
                # emptiness cannot be trusted.
                create_schema=False,
            )
            manager = ProvenanceManager(storage=storage)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            self._error = f"provenance store unavailable: {exc}"
            return
        self._backend_cached = (storage, manager)

    def close(self) -> None:
        """Release the pool. Safe to call more than once."""
        with self._lock:
            if self._backend_cached is not None:
                try:
                    self._backend_cached[0].close()
                except Exception:  # noqa: BLE001 - best effort on shutdown
                    pass
                self._backend_cached = None

    # -- reads ----------------------------------------------------------

    def resolve(self, ids: Sequence[str]) -> Resolution:
        """Look up every id, preserving order and reporting the misses."""
        if not ids:
            return Resolution(records=[], missing=[])
        backend = self._backend()
        if backend is None:
            return Resolution(records=[], missing=[], error=self._error)
        storage, _ = backend
        records: list[ProvenanceRecord] = []
        missing: list[str] = []
        try:
            for entity_id in ids:
                entry = storage.retrieve(entity_id)
                if entry is None:
                    missing.append(entity_id)
                else:
                    records.append(ProvenanceRecord.from_entry(entry))
        except Exception as exc:  # noqa: BLE001 - surfaced as a field
            return Resolution(
                records=records,
                missing=missing,
                error=f"provenance lookup failed: {exc}",
            )
        return Resolution(records=records, missing=missing)

    def lineage(self, entity_id: str, max_depth: int = 4) -> list[ProvenanceRecord]:
        """Ancestors of an entity: for a verb edge, the source row it came from."""
        backend = self._backend()
        if backend is None:
            return []
        _, manager = backend
        try:
            return [
                ProvenanceRecord.from_entry(entry)
                for entry in manager.trace_lineage(entity_id, max_depth=max_depth)
            ]
        except Exception:  # noqa: BLE001 - lineage is an extra, not the answer
            return []

    def verify_chain(self) -> dict[str, Any]:
        """Walk the hash chain, reporting the first breaks if any.

        Keys are snake_case like every other response of this service — the
        route validates this dict straight into its response model, so a
        camelCase key here is silently dropped and the report reads as an empty
        chain. That is exactly the kind of failure audit reporting cannot have.
        """
        backend = self._backend()
        if backend is None:
            return {
                "available": False,
                "error": self._error,
                "valid": None,
                "total_entries": 0,
                "broken_links": [],
            }
        _, manager = backend
        try:
            report = manager.verify_chain()
        except Exception as exc:  # noqa: BLE001 - surfaced as a field
            return {
                "available": False,
                "error": f"chain verification failed: {exc}",
                "valid": None,
                "total_entries": 0,
                "broken_links": [],
            }
        broken = report.get("broken_links") or []
        return {
            "available": True,
            "error": None,
            "valid": bool(report.get("valid")),
            "total_entries": int(report.get("total_entries") or 0),
            "broken_links": broken[:20],
        }

    def entity_ids(self, ids: Iterable[str]) -> set[str]:
        """Which of these ids the store actually holds."""
        backend = self._backend()
        if backend is None:
            return set()
        storage, _ = backend
        present: set[str] = set()
        for entity_id in ids:
            try:
                if storage.retrieve(entity_id) is not None:
                    present.add(entity_id)
            except Exception:  # noqa: BLE001 - a probe, not a result
                continue
        return present

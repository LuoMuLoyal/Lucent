"""V3 leaflet parser — reads DrugEntityDedup/leaflets_dedup.parquet.

DB schema (post V3 migration) uses V3 column names directly. This parser
maps V3 Parquet columns → DB columns with no renaming needed (the schema
was aligned to V3 in the 20260917120000 migration).
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Iterator

from common import emit_error, emit_record, normalize_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def to_record(row_number: int, row: dict[str, Any]) -> dict[str, Any] | None:
    entity_id = normalize_text(row.get("entity_id"))
    if not entity_id:
        emit_error("Missing entity_id", row_number)
        return None

    instruction_id = normalize_text(row.get("instruction_id"))
    if not instruction_id:
        emit_error("Missing instruction_id", row_number)
        return None

    approval_codes = _parse_pipe_list(row.get("approval_codes"))
    source_row = _parse_int(row.get("source_row"))

    return {
        "id": entity_id,
        "instruction_id": instruction_id,
        "source_row": source_row,
        "source_url": normalize_text(row.get("source_url")),
        "generic_name": normalize_text(row.get("generic_name")),
        "brand_name": normalize_text(row.get("brand_name")),
        "approval_text": normalize_text(row.get("approval_text")),
        "approval_codes": approval_codes,
        "category": normalize_text(row.get("category")),
        "manufacturer": normalize_text(row.get("manufacturer")),
        "manufacturer_clean": normalize_text(row.get("manufacturer_clean")),
        "regulatory_class": normalize_text(row.get("regulatory_class")),
        "related_diseases": normalize_text(row.get("related_diseases")),
        "appearance": normalize_text(row.get("appearance")),
        "ingredients": normalize_text(row.get("ingredients")),
        "indications": normalize_text(row.get("indications")),
        "package_spec": normalize_text(row.get("package_spec")),
        "adverse_reactions": normalize_text(row.get("adverse_reactions")),
        "dosage": normalize_text(row.get("dosage")),
        "contraindications": normalize_text(row.get("contraindications")),
        "precautions": normalize_text(row.get("precautions")),
        "pregnancy_lactation": normalize_text(row.get("pregnancy_lactation")),
        "pediatric_use": normalize_text(row.get("pediatric_use")),
        "geriatric_use": normalize_text(row.get("geriatric_use")),
        "drug_interactions": normalize_text(row.get("drug_interactions")),
        "pharmacology_toxicology": normalize_text(
            row.get("pharmacology_toxicology")
        ),
        "pharmacokinetics": normalize_text(row.get("pharmacokinetics")),
        "storage": normalize_text(row.get("storage")),
        "validity_period": normalize_text(row.get("validity_period")),
    }


def iter_rows(source_path: str) -> Iterator[tuple[int, dict[str, Any]]]:
    """Read V3 leaflets_dedup.parquet via pyarrow and yield row dicts."""
    try:
        import pyarrow.parquet as pq
    except ModuleNotFoundError:
        raise SystemExit(
            "pyarrow is required for V3 Parquet imports. "
            "Run `pip install -r scripts/import/medicine/requirements.txt`."
        )

    table = pq.read_table(source_path)
    col_names = table.column_names
    for row_number, batch_idx in enumerate(range(len(table)), start=1):
        row = {col: table.column(col)[batch_idx].as_py() for col in col_names}
        yield row_number, row


def _parse_pipe_list(value: Any) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    return [item.strip() for item in text.split("|") if item.strip()]


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def main() -> None:
    args = parse_args()
    rows = iter_rows(args.source_path)

    emitted = 0
    for row_number, row in rows:
        record = to_record(row_number, row)
        if record is None:
            continue

        emit_record(record)
        emitted += 1
        if args.limit is not None and emitted >= args.limit:
            break


if __name__ == "__main__":
    main()

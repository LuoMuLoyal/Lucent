"""V3 product parser — reads DrugEntityDedup/products_dedup.parquet.

DB schema (post V3 migration): product table is a catalogue only —
no body text columns. Column names match V3 directly (no renaming).
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

    product_name = normalize_text(row.get("product_name"))
    if not product_name:
        emit_error("Missing product_name", row_number)
        return None

    source_row_number = _parse_source_row(row.get("product_id"))

    approval_codes = _parse_pipe_list(row.get("approval_codes"))
    barcode = normalize_text(row.get("barcode"))
    national_drug_code = normalize_text(row.get("national_drug_code"))
    manufacturer = normalize_text(row.get("manufacturer"))
    approval_number = normalize_text(row.get("approval_number"))
    manufacturer_clean = normalize_text(row.get("manufacturer_clean"))

    search_text = " ".join(
        filter(None, [
            product_name,
            normalize_text(row.get("brand_name")),
            manufacturer,
            manufacturer_clean,
            approval_number,
            barcode,
            national_drug_code,
        ])
    )

    return {
        "id": entity_id,
        "source_name": "chinese_drug_data_v3",
        "source_row_number": source_row_number,
        "name": product_name,
        "image_url": normalize_text(row.get("image_url")),
        "price_text": normalize_text(row.get("price_text")),
        "package_spec": normalize_text(row.get("package_spec")),
        "approval_number": approval_number,
        "manufacturer": manufacturer,
        "drug_type": normalize_text(row.get("drug_type")),
        "main_category": normalize_text(row.get("main_category")),
        "subcategory": normalize_text(row.get("subcategory")),
        "source_url": normalize_text(row.get("source_url")),
        "brand_name": normalize_text(row.get("brand_name")),
        "overdose": normalize_text(row.get("overdose")),
        "barcode": barcode,
        "national_drug_code": national_drug_code,
        "manufacturer_clean": manufacturer_clean,
        "approval_codes": approval_codes,
        "search_text": search_text if search_text.strip() else None,
        "extras": None,
    }


def iter_rows(source_path: str) -> Iterator[tuple[int, dict[str, Any]]]:
    """Read V3 products_dedup.parquet via pyarrow and yield row dicts."""
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


def _parse_source_row(value: Any) -> int | None:
    """V3 product_id carries the source row id; keep it as the row number."""
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

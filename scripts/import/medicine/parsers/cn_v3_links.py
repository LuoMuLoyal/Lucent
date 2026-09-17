"""V3 product↔leaflet link parser — reads DrugEntityDedup/product_leaflet_links.parquet.

V3's link table is a clean 1:1 map (every product gets exactly one leaflet):
  product_entity_id → cn_medicine_products.id (V3 entity_id)
  leaflet_entity_id → cn_medicine_leaflets.id  (V3 entity_id)
  match_type        → match_type
  match_key         → match_key (the code the match was made on, if any)
  match_score       → match_score (confidence, mapped to DB Int)

The DB link table references rows in cn_medicine_products /
cn_medicine_leaflets via product_id / leaflet_id. Since the V3 entity_id IS
the primary key for both tables, product_entity_id / leaflet_entity_id map
directly.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Iterator

from common import emit_error, emit_record, normalize_text, stable_uuid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def to_record(
    row_number: int,
    row: dict[str, Any],
) -> dict[str, Any] | None:
    product_entity_id = normalize_text(row.get("product_entity_id"))
    leaflet_entity_id = normalize_text(row.get("leaflet_entity_id"))
    if not product_entity_id:
        emit_error("Missing product_entity_id", row_number)
        return None
    if not leaflet_entity_id:
        emit_error("Missing leaflet_entity_id", row_number)
        return None

    match_type = normalize_text(row.get("match_type"))
    match_key = normalize_text(row.get("match_key"))
    match_score = _parse_float(row.get("match_score"))

    # Build the link id from the two entity ids; the link row itself carries
    # no extra key.
    link_id = stable_uuid(
        "cn_product_leaflet_link",
        product_entity_id,
        leaflet_entity_id,
    )

    return {
        "id": link_id,
        "product_id": product_entity_id,
        "leaflet_id": leaflet_entity_id,
        "match_type": match_type,
        "match_key": match_key,
        "match_score": _score_to_int(match_score),
        "is_best_match": True,
    }


def iter_rows(source_path: str) -> Iterator[tuple[int, dict[str, Any]]]:
    """Read V3 product_leaflet_links.parquet via pyarrow and yield row dicts."""
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


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _score_to_int(value: float | None) -> int | None:
    """V3 match_score is a confidence (1.0/0.9/0.6); DB column is Int.

    Map confidence tiers to the same ordinal scale V2 used for its Int scores.
    """
    if value is None:
        return None
    if value >= 1.0:
        return 100
    if value >= 0.9:
        return 90
    if value >= 0.6:
        return 60
    return int(value * 100)


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

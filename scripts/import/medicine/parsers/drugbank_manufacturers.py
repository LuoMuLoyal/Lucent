"""Emits one row per DrugBank manufacturer.

Source column: `manufacturers`, shape `{"manufacturer": [...]}` where each entry
is `{"@": {"generic": "false", "url": "..."}, "#": "<name>"}` — attributes under
`@`, text under `#`. See `drugbank_synonyms.py` for the same convention.
"""

from __future__ import annotations

import argparse

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached, unwrap_list


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def parse_flag(value: str | None) -> bool | None:
    text = normalize_text(value)
    if text is None:
        return None
    lowered = text.lower()
    if lowered in ("true", "yes", "1"):
        return True
    if lowered in ("false", "no", "0"):
        return False
    return None


def main() -> None:
    args = parse_args()

    table = pq.read_table(args.source_path, columns=["drugbank_id", "manufacturers"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("manufacturers").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for entry in unwrap_list(cell, "manufacturer"):
            name = normalize_text(entry.get("#"))
            if name is None:
                emit_error("Manufacturer without name", row_number)
                continue

            attrs = entry.get("@") or {}
            if not isinstance(attrs, dict):
                attrs = {}

            emit_record(
                {
                    "id": stable_uuid("drugbank_manufacturers", source_id, name),
                    "drugbank_id": source_id,
                    "name": name,
                    "generic": parse_flag(attrs.get("generic")),
                    "url": normalize_text(attrs.get("url")),
                }
            )


if __name__ == "__main__":
    main()

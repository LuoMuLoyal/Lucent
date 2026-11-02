"""Emits one row per DrugBank packager.

Source column: `packagers`, shape `{"packager": [{"name": ..., "url": ...}]}`.
Unlike synonyms/manufacturers these entries use named keys rather than `@`/`#`.
"""

from __future__ import annotations

import argparse

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached, text_of, unwrap_list


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    table = pq.read_table(args.source_path, columns=["drugbank_id", "packagers"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("packagers").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for entry in unwrap_list(cell, "packager"):
            name = text_of(entry, "name")
            if name is None:
                emit_error("Packager without name", row_number)
                continue

            emit_record(
                {
                    "id": stable_uuid("drugbank_packagers", source_id, name),
                    "drugbank_id": source_id,
                    "name": name,
                    "url": text_of(entry, "url"),
                }
            )


if __name__ == "__main__":
    main()

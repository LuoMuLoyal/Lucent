"""Emits one row per DrugBank dosage record.

Source column: `dosages`, shape `{"dosage": [{"form": ..., "route": ..., "strength": ...}]}`.

All three fields are nullable in the source; a row with all three null carries no
information and is skipped rather than inserted as an empty triple.
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

    table = pq.read_table(args.source_path, columns=["drugbank_id", "dosages"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("dosages").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for entry in unwrap_list(cell, "dosage"):
            form = text_of(entry, "form")
            route = text_of(entry, "route")
            strength = text_of(entry, "strength")

            if form is None and route is None and strength is None:
                continue

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_dosages",
                        source_id,
                        form or "",
                        route or "",
                        strength or "",
                    ),
                    "drugbank_id": source_id,
                    "form": form,
                    "route": route,
                    "strength": strength,
                }
            )


if __name__ == "__main__":
    main()

"""Emits one row per DrugBank external identifier.

Source column: `external_identifiers`, shape
`{"external-identifier": [{"resource": "ChEBI", "identifier": "15377"}]}`.

These are database cross-references (not web links, which live in
`drugbank_external_links`). The `resource`-`identifier` pair is what makes
reverse lookup possible: a user holding `ChEBI:15377` can find the drug.
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

    table = pq.read_table(
        args.source_path, columns=["drugbank_id", "external_identifiers"]
    )
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("external_identifiers").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for entry in unwrap_list(cell, "external-identifier"):
            resource = text_of(entry, "resource")
            identifier = text_of(entry, "identifier")
            if resource is None or identifier is None:
                emit_error("External identifier missing resource or value", row_number)
                continue

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_external_identifiers",
                        source_id,
                        resource,
                        identifier,
                    ),
                    "drugbank_id": source_id,
                    "resource": resource,
                    "identifier": identifier,
                }
            )


if __name__ == "__main__":
    main()

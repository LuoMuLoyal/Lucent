"""Emits one row per DrugBank synonym.

Source column: `synonyms`, shape `{"synonym": [...]}` where each entry is:

    {"@": {"language": "english", "coder": ""}, "#": "[Leu1, Thr2]-..."}

i.e. attributes live under `@` and the text under `#` — an XML-to-JSON artefact
of the parquet exporter. Both are normalised here so callers never see it.

Why a table instead of the old `search_text` concatenation: the previous import
folded `synonyms[:20]` into one blob, which truncated long lists and made it
impossible to tell *which* synonym matched, or to filter by language / INN.
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


def main() -> None:
    args = parse_args()

    table = pq.read_table(args.source_path, columns=["drugbank_id", "synonyms"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("synonyms").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for entry in unwrap_list(cell, "synonym"):
            text = normalize_text(entry.get("#"))
            if text is None:
                # A synonym entry without text carries no information.
                continue

            attrs = entry.get("@") or {}
            if not isinstance(attrs, dict):
                attrs = {}

            emit_record(
                {
                    "id": stable_uuid("drugbank_synonyms", source_id, text),
                    "drugbank_id": source_id,
                    "synonym": text,
                    "language": normalize_text(attrs.get("language")),
                    # Source uses an empty string when no coder is recorded.
                    "coder": normalize_text(attrs.get("coder")),
                }
            )


if __name__ == "__main__":
    main()

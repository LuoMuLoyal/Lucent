"""Emits one row per DrugBank drug-drug interaction.

Source column: `drug_interactions` in `drugbank_drugs.parquet`, shape
`{"drug-interaction": [...]}` — see `drugbank_nested.py` for the single-object
vs list inconsistency.

The partner drug is stored by ID **without a foreign key**: DrugBank lists
interactions with compounds that are not in `drugbank_drugs` (withdrawn products,
entities contributed by other sources). A hard FK would reject those rows, and
dropping them would silently shrink the interaction graph.
"""

from __future__ import annotations

import argparse
import json

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
        args.source_path, columns=["drugbank_id", "drug_interactions"]
    )
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("drug_interactions").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for interaction in unwrap_list(cell, "drug-interaction"):
            partner = text_of(interaction, "drugbank-id")
            if partner is None:
                emit_error("Interaction without partner DrugBank ID", row_number)
                continue

            emit_record(
                {
                    "id": stable_uuid("drugbank_drug_interactions", source_id, partner),
                    "drugbank_id": source_id,
                    "interacts_with_id": partner,
                    "interacts_with_name": text_of(interaction, "name"),
                    "description": text_of(interaction, "description"),
                }
            )


if __name__ == "__main__":
    main()

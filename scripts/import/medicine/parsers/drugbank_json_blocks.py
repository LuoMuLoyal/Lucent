"""Emits one row per drug carrying a nested JSON block, for the jsonb columns.

Source columns in `drugbank_drugs.parquet`, selected with `--column`:

  `pathways`                 -> `DrugbankDrug.pathways`
  `reactions`                -> `DrugbankDrug.reactions`
  `snp_effects`              -> `DrugbankDrug.snpEffects`
  `snp_adverse_drug_reactions` -> `DrugbankDrug.snpAdverseEffects`

These stay as JSON (PRODUCT §3) because the only read pattern is "fetch the whole
block for one drug": pathways are many-to-many with ~3% coverage, reaction chains
are variable-length and their intermediates are DBMET metabolic entities that are
not drugs, and SNP effects cover 0.4% of the corpus and are display-only.

Unlike the table-backed parsers, the block is stored **as-is** (decoded and
re-encoded, not restructured): normalising it here would bake in assumptions
about a shape that only ever gets rendered, not filtered on. The `--limit`
therefore counts drugs, each emitted row being one drug.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text

# Parquet column -> the jsonb column it is stored in. The two differ for
# `snp_adverse_drug_reactions`, whose parquet name describes the source grouping
# while the stored field describes the subject (variant-linked adverse effects).
TARGET_COLUMNS = {
    "pathways": "pathways",
    "reactions": "reactions",
    "snp_effects": "snp_effects",
    "snp_adverse_drug_reactions": "snp_adverse_effects",
}

COLUMNS = tuple(TARGET_COLUMNS)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--column", required=True, choices=COLUMNS)
    return parser.parse_args()


def decode_block(cell: Any) -> Any:
    """Decodes a parquet JSON cell into a Python value, or None when empty.

    A cell that fails to parse is reported as an error upstream rather than
    stored as a raw string, so a malformed block cannot reach the database
    looking like valid JSON.
    """
    if cell is None:
        return None
    if isinstance(cell, str):
        text = cell.strip()
        if not text:
            return None
        return json.loads(text)
    return cell


def main() -> None:
    args = parse_args()

    table = pq.read_table(
        args.source_path, columns=["drugbank_id", "name", args.column]
    )
    drugbank_ids = table.column("drugbank_id").to_pylist()
    names = table.column("name").to_pylist()
    blocks = table.column(args.column).to_pylist()

    emitted = 0
    for row_number, (drugbank_id, name, cell) in enumerate(
        zip(drugbank_ids, names, blocks), start=2
    ):
        if args.limit is not None and (row_number - 2) >= args.limit:
            return

        normalized_id = normalize_text(drugbank_id)
        if normalized_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        try:
            block = decode_block(cell)
        except json.JSONDecodeError:
            emit_error(f"Malformed JSON in {args.column}", row_number)
            continue

        if block is None:
            continue

        # `name` is emitted only because the upsert inserts a whole row into
        # `drugbank_drugs`, where it is NOT NULL. It is deliberately absent from
        # `updateColumns`, so a block import never rewrites an existing name.
        emit_record(
            {
                "drugbank_id": normalized_id,
                "name": normalize_text(name) or normalized_id,
                TARGET_COLUMNS[args.column]: block,
            }
        )
        emitted += 1


if __name__ == "__main__":
    main()

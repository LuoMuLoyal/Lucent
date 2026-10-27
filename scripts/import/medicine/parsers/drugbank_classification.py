"""Emits one row per DrugBank chemical classification path, plus group memberships.

Two independent outputs share this module because both are single-row-per-drug
projections of flat JSON (not nested lists):

- `classification`: one row per drug holding the whole
  Kingdom -> Superclass -> Class -> Subclass -> Direct Parent path. Stored as a
  path (not a node) so `WHERE kingdom = 'Organic Compounds'` works directly.
- `groups`: one row per (drug, group) membership.
- `drugbank-classification-groups` is the registry key; `--column` selects which
  of the two to emit.

Both sources are objects of scalars, so `unwrap_list` does not apply.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--column", required=True, choices=["classification", "groups"])
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def load_cell(cell: Any) -> dict[str, Any] | None:
    """Parses a JSON cell into a dict; anything else yields None."""
    if cell is None:
        return None
    raw = cell
    if isinstance(cell, str):
        text = cell.strip()
        if not text:
            return None
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return None
    return raw if isinstance(raw, dict) else None


def text(value: Any) -> str | None:
    return normalize_text(value)


def main() -> None:
    args = parse_args()

    table = pq.read_table(args.source_path, columns=["drugbank_id", args.column])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column(args.column).to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        record = load_cell(cell)
        if record is None:
            continue

        if args.column == "classification":
            kingdom = text(record.get("kingdom"))
            superclass = text(record.get("superclass"))
            klass = text(record.get("class"))
            subclass = text(record.get("subclass"))
            direct_parent = text(record.get("direct-parent"))

            # Skip an all-null path: it would occupy the unique slot with nothing.
            if not any((kingdom, superclass, klass, subclass, direct_parent)):
                continue

            emit_record(
                {
                    "id": stable_uuid("drugbank_classifications", source_id),
                    "drugbank_id": source_id,
                    "kingdom": kingdom,
                    "superclass": superclass,
                    "class": klass,
                    "subclass": subclass,
                    "direct_parent": direct_parent,
                    "description": text(record.get("description")),
                }
            )
            continue

        # groups: {"group": ["approved", "withdrawn"]}; a single value arrives as
        # a bare string.
        raw_groups = record.get("group")
        if isinstance(raw_groups, str):
            raw_groups = [raw_groups]
        if not isinstance(raw_groups, list):
            continue

        for raw in raw_groups:
            group_name = normalize_text(raw)
            if group_name is None:
                continue
            emit_record(
                {
                    "id": stable_uuid("drugbank_groups", source_id, group_name),
                    "drugbank_id": source_id,
                    "group_name": group_name,
                }
            )


if __name__ == "__main__":
    main()

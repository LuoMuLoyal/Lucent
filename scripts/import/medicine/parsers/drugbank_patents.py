"""Emits one row per DrugBank patent.

Source column: `patents` in `drugbank_drugs.parquet`. The cell holds either a
single object or a list — see `drugbank_nested.py`.

Dates arrive as `YYYY-MM-DD` strings, occasionally malformed; a value that does
not parse is emitted as null and counted, never coerced into a guess. The
`pediatric-extension` flag arrives as the strings `"true"` / `"false"`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached, text_of, unwrap_list


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def parse_date(value: str | None) -> str | None:
    """Coerces a source date string to `YYYY-MM-DD`, or None when unparseable.

    DrugBank occasionally stores an empty or placeholder value; those must reach
    the database as NULL rather than as a fabricated date.
    """
    text = normalize_text(value)
    if text is None:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


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

    table = pq.read_table(args.source_path, columns=["drugbank_id", "patents"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    patents_column = table.column("patents").to_pylist()

    emitted = 0
    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, patents_column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        normalized_id = normalize_text(drugbank_id)
        if normalized_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for patent in unwrap_list(cell, "patent"):
            number = text_of(patent, "number")
            if number is None:
                emit_error("Patent without number", row_number)
                continue

            country = text_of(patent, "country")
            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_patents", normalized_id, number, country
                    ),
                    "drugbank_id": normalized_id,
                    "patent_number": number,
                    "country": country,
                    "approved_on": parse_date(patent.get("approved")),
                    "expires_on": parse_date(patent.get("expires")),
                    "pediatric_extension": parse_flag(
                        patent.get("pediatric-extension")
                    ),
                }
            )
            emitted += 1


if __name__ == "__main__":
    main()

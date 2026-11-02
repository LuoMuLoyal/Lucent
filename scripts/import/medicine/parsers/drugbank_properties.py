"""Emits one row per (drug, property, source) for experimental or computed data.

Source columns in `drugbank_drugs.parquet`:
  - `experimental_properties` — measured values (melting point, solubility, ...)
  - `calculated_properties`   — model-predicted values (ALOGPS / ChemAxon logP, ...)

Both columns share the same `{"property": [...]}` shape, so one parser handles
them; `--column` picks the source and `--computed` sets `is_experimental`.

Why a table and not a column: the same property appears several times per drug
with different values and attributions (a melting point from Health Canada's
label and another from a 1991 paper are both present and both legitimate; ALOGPS
and ChemAxon disagree on logP by more than an order of magnitude). Collapsing to
one column would discard the provenance, which is precisely what makes these
numbers citable.

Numeric extraction (`value_num` / `unit`): values arrive as free text —
`"65 °C"`, `"3.7"`, `"Soluble"`, `"4.64e-02 g/l"`. The verbatim string is always
stored in `value_text`. `value_num` is filled **only** when a leading number
parses cleanly, so `WHERE value_num < 100` never silently matches a row whose
text was not actually numeric. The remainder of the string becomes `unit`.

`--limit` counts **drugs**, not emitted rows: these are one-to-many relations and
a row-based limit would silently truncate the set of drugs covered.
"""

from __future__ import annotations

import argparse
import re

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached, text_of, unwrap_list

# A leading signed decimal; the rest of the string is treated as the unit.
_NUMBER_PREFIX = re.compile(r"^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(.*)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--column",
        default="experimental_properties",
        choices=("experimental_properties", "calculated_properties"),
        help="Which parquet column to read.",
    )
    parser.add_argument(
        "--computed",
        action="store_true",
        help=(
            "Mark rows as computed rather than experimental. Set this when "
            "reading calculated_properties."
        ),
    )
    return parser.parse_args()


def split_number(value: str) -> tuple[float | None, str | None]:
    """Splits `"65 °C"` into (65.0, "°C"); `"Soluble"` into (None, None).

    Returns (None, None) when the value does not start with a number, so the
    caller stores the text alone instead of inventing a magnitude.
    """
    match = _NUMBER_PREFIX.match(value)
    if match is None:
        return None, None
    try:
        number = float(match.group(1))
    except ValueError:
        return None, None
    unit = normalize_text(match.group(2)) or None
    return number, unit


def main() -> None:
    args = parse_args()

    table = pq.read_table(args.source_path, columns=["drugbank_id", args.column])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    properties_column = table.column(args.column).to_pylist()

    emitted = 0
    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, properties_column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        normalized_id = normalize_text(drugbank_id)
        if normalized_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for prop in unwrap_list(cell, "property"):
            kind = text_of(prop, "kind")
            value = text_of(prop, "value")
            if kind is None or value is None:
                continue

            source = text_of(prop, "source")
            number, unit = split_number(value)

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_properties", normalized_id, kind, source
                    ),
                    "drugbank_id": normalized_id,
                    "kind": kind,
                    "value_text": value,
                    "value_num": number,
                    "unit": unit,
                    "source": source,
                    "is_experimental": not args.computed,
                }
            )
            emitted += 1


if __name__ == "__main__":
    main()

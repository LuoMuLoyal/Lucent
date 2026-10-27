"""Emits one row per DrugBank product (marketed/branded formulation).

Source column: `products`, shape `{"product": [...]}`.

Storefront data: `fda-application-number`, `generic`, `over-the-counter` and
`approved` arrive as the strings `"true"` / `"false"` (or empty), so they are
parsed through `parse_flag` rather than trusted as booleans. Marketing dates are
`YYYY-MM-DD`; an unparseable value becomes NULL, never a fabricated date.
"""

from __future__ import annotations

import argparse
import datetime as dt

import pyarrow.parquet as pq

from common import emit_error, emit_record, normalize_text, stable_uuid
from drugbank_nested import row_limit_reached, text_of, unwrap_list


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def parse_date(value: str | None) -> str | None:
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

    table = pq.read_table(args.source_path, columns=["drugbank_id", "products"])
    drugbank_ids = table.column("drugbank_id").to_pylist()
    column = table.column("products").to_pylist()

    for row_number, (drugbank_id, cell) in enumerate(
        zip(drugbank_ids, column), start=2
    ):
        if row_limit_reached(row_number - 2, args.limit):
            return

        source_id = normalize_text(drugbank_id)
        if source_id is None:
            emit_error("Missing required DrugBank ID", row_number)
            continue

        for product in unwrap_list(cell, "product"):
            name = text_of(product, "name")
            if name is None:
                emit_error("Product without name", row_number)
                continue

            # A drug lists the same product name under several NDAs/labellers, so
            # the identity includes both to stay unique.
            labeller = text_of(product, "labeller")
            ndc_code = text_of(product, "ndc-product-code")

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_products", source_id, name, labeller or "", ndc_code or ""
                    ),
                    "drugbank_id": source_id,
                    "name": name,
                    "labeller": labeller,
                    "ndc_id": text_of(product, "ndc-id"),
                    "ndc_product_code": ndc_code,
                    "dpd_id": text_of(product, "dpd-id"),
                    "ema_product_code": text_of(product, "ema-product-code"),
                    "ema_ma_number": text_of(product, "ema-ma-number"),
                    "dosage_form": text_of(product, "dosage-form"),
                    "strength": text_of(product, "strength"),
                    "route": text_of(product, "route"),
                    "fda_application_number": text_of(product, "fda-application-number"),
                    "generic": parse_flag(product.get("generic")),
                    "over_the_counter": parse_flag(product.get("over-the-counter")),
                    "approved": parse_flag(product.get("approved")),
                    "country": text_of(product, "country"),
                    "started_marketing_on": parse_date(product.get("started-marketing-on")),
                    "ended_marketing_on": parse_date(product.get("ended-marketing-on")),
                    "source": text_of(product, "source"),
                }
            )


if __name__ == "__main__":
    main()

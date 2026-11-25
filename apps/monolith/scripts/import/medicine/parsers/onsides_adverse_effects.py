"""Aggregates OnSIDES v3.1.1 label-level ADE pairs up to ingredient × reaction.

Source is a set of CSVs (no parquet): 6.93M rows in `product_adverse_effect.csv`
carried at label granularity. The plan stores one row per (ingredient CUI,
MedDRA term) instead — the label-level detail is never queried on its own and
is what makes the raw table 6.93M rows.

The upward walk is label → product → ingredient:

    product_adverse_effect.product_label_id → product_to_rxnorm.label_id
      → product_to_rxnorm.rxnorm_product_id
      → vocab_rxnorm_ingredient_to_product.product_id
      → vocab_rxnorm_ingredient_to_product.ingredient_id

Aggregation (per ingredient × MedDRA term):

    label_count     count of distinct labels that reported the pair
    sections        distinct label_section values (AR / WP / NA / BW)
    sources         distinct regulatory sources of those labels (US/JP/UK/EU)
    confidence_max  max(pred1) — NOT pred0. See the plan's §2.2.1: pred0 is
                    zero for 44.5% of rows and above 1 for 36% of them, so it
                    cannot carry a threshold. pred0_max is still emitted for
                    provenance only.
    pred0_max       max of the non-zero pred0 values, nullable

Emits NDJSON the shared importer already understands: one `record` per row,
one `error` per rejected row.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import emit_error, emit_record, normalize_text, stable_uuid  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    # `--source-path` points at the CSV directory (`.../v3.1.1/csv`), matching
    # how the shared importer resolves a dataset root.
    parser.add_argument("--source-path", required=True)
    # The shared importer upserts one table per call, so the two tables are two
    # separate passes over the same source.
    parser.add_argument(
        "--part",
        required=True,
        choices=["reactions", "effects"],
        help="reactions = MedDRA dictionary; effects = ingredient×reaction facts",
    )
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def read_label_sources(csv_dir: Path) -> dict[str, str]:
    """label_id → regulatory source (US / JP / UK / EU)."""
    sources: dict[str, str] = {}
    with (csv_dir / "product_label.csv").open(
        "r", encoding="utf-8", newline=""
    ) as handle:
        for row in csv.DictReader(handle):
            label_id = normalize_text(row.get("label_id"))
            source = normalize_text(row.get("source"))
            if label_id and source:
                sources[label_id] = source
    return sources


def read_meddra_terms(csv_dir: Path) -> dict[str, tuple[str, str]]:
    """meddra_id → (name, term_type)."""
    terms: dict[str, tuple[str, str]] = {}
    with (csv_dir / "vocab_meddra_adverse_effect.csv").open(
        "r", encoding="utf-8", newline=""
    ) as handle:
        for row in csv.DictReader(handle):
            meddra_id = normalize_text(row.get("meddra_id"))
            name = normalize_text(row.get("meddra_name"))
            if meddra_id and name:
                terms[meddra_id] = (
                    name,
                    normalize_text(row.get("meddra_term_type")) or "LLT",
                )
    return terms


def main() -> int:
    args = parse_args()
    csv_dir = Path(args.source_path).resolve()

    for required in (
        "product_adverse_effect.csv",
        "product_to_rxnorm.csv",
        "vocab_rxnorm_ingredient_to_product.csv",
        "product_label.csv",
        "vocab_meddra_adverse_effect.csv",
    ):
        if not (csv_dir / required).exists():
            raise SystemExit(f"missing source file: {csv_dir / required}")

    meddra_terms = read_meddra_terms(csv_dir)

    if args.part == "reactions":
        for meddra_id, (name, term_type) in meddra_terms.items():
            emit_record(
                {
                    "id": stable_uuid("onsides_adverse_reaction", meddra_id),
                    "meddra_id": meddra_id,
                    "meddra_name": name,
                    "meddra_term_type": term_type,
                }
            )
        print(
            f"[onsides] {len(meddra_terms)} MedDRA term(s)",
            file=sys.stderr,
        )
        return 0

    sources_by_label = read_label_sources(csv_dir)

    connection = duckdb.connect()
    # The upward walk is a 4-way join over a 400 MB CSV. DuckDB reads the CSVs
    # directly, so nothing has to be pre-converted to parquet.
    result = connection.execute(
        """
        SELECT
            i2p.ingredient_id              AS rxnorm_cui,
            pae.effect_meddra_id::VARCHAR AS meddra_id,
            pae.product_label_id::VARCHAR AS label_id,
            pae.label_section            AS label_section,
            pae.pred0                    AS pred0,
            pae.pred1                    AS pred1
        FROM read_csv_auto(?, header = true,
                           all_varchar = true) AS pae
        JOIN read_csv_auto(?, header = true,
                           all_varchar = true) AS p2r
          ON p2r.label_id = pae.product_label_id
        JOIN read_csv_auto(?, header = true,
                           all_varchar = true) AS i2p
          ON i2p.product_id = p2r.rxnorm_product_id
        WHERE pae.effect_meddra_id IS NOT NULL
        """,
        [
            str(csv_dir / "product_adverse_effect.csv"),
            str(csv_dir / "product_to_rxnorm.csv"),
            str(csv_dir / "vocab_rxnorm_ingredient_to_product.csv"),
        ],
    )

    aggregated: dict[tuple[str, str], dict] = {}
    seen_labels: dict[tuple[str, str], set[str]] = defaultdict(set)
    rejected = 0
    row_number = 0

    while True:
        batch = result.fetchmany(200_000)
        if not batch:
            break
        for rxnorm_cui, meddra_id, label_id, section, pred0, pred1 in batch:
            row_number += 1
            if args.limit is not None and row_number > args.limit:
                break

            # `all_varchar = true` is required because the id columns mix pure
            # digits with OMOP-prefixed values (`OMOP4985567`), which DuckDB's
            # type inference would otherwise cast to INT64 and fail on. The cost
            # is that the two score columns arrive as strings too.
            pred0_value = float(pred0) if pred0 not in (None, "") else None
            pred1_value = float(pred1) if pred1 not in (None, "") else None

            key = (rxnorm_cui, meddra_id)
            entry = aggregated.get(key)
            if entry is None:
                if meddra_id not in meddra_terms:
                    # The FK integrity check already reported zero dangling
                    # MedDRA ids; a miss here means the source changed shape.
                    emit_error(
                        f"unknown MedDRA id {meddra_id!r} for ingredient "
                        f"{rxnorm_cui!r}",
                        row_number,
                    )
                    rejected += 1
                    continue
                entry = {
                    "rxnorm_cui": rxnorm_cui,
                    "meddra_id": meddra_id,
                    "label_count": 0,
                    "sections": set(),
                    "sources": set(),
                    "confidence_max": None,
                    "pred0_max": None,
                }
                aggregated[key] = entry

            if label_id in seen_labels[key]:
                continue
            seen_labels[key].add(label_id)
            entry["label_count"] += 1

            section = normalize_text(section)
            if section:
                entry["sections"].add(section)
            source = sources_by_label.get(label_id)
            if source:
                entry["sources"].add(source)

            if pred1_value is not None and (
                entry["confidence_max"] is None
                or pred1_value > entry["confidence_max"]
            ):
                entry["confidence_max"] = pred1_value
            # pred0 is provenance only: zero means "no score", so it must not
            # win the max the way a real 0.001 would.
            if pred0_value is not None and pred0_value > 0:
                if (
                    entry["pred0_max"] is None
                    or pred0_value > entry["pred0_max"]
                ):
                    entry["pred0_max"] = pred0_value

        if args.limit is not None and row_number > args.limit:
            break

    for (rxnorm_cui, meddra_id), entry in aggregated.items():
        emit_record(
            {
                "id": stable_uuid(
                    "onsides_ingredient_adverse_effect", rxnorm_cui, meddra_id
                ),
                "rxnorm_cui": rxnorm_cui,
                "reaction_id": stable_uuid(
                    "onsides_adverse_reaction", meddra_id
                ),
                "label_count": entry["label_count"],
                "label_sections": sorted(entry["sections"]),
                "sources": sorted(entry["sources"]),
                # A pair with no pred1 at all keeps NULL rather than 0, so the
                # presentation layer can tell "unscored" from "scored low".
                "confidence_max": entry["confidence_max"],
                "pred0_max": entry["pred0_max"],
            }
        )

    connection.close()
    print(
        f"[onsides] {len(aggregated)} ingredient×reaction pair(s) from "
        f"{row_number} source row(s), {rejected} rejected",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
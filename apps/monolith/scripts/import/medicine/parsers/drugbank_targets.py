from __future__ import annotations

import argparse
import csv

from common import emit_error, emit_record, normalize_list, normalize_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--source-dataset", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def split_multi_value(value: str | None) -> list[str]:
    if value is None:
        return []

    raw_parts = value.replace("|", ";").split(";")
    return normalize_list(raw_parts)


def get_first_value(row: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = normalize_text(row.get(key))
        if value is not None:
            return value
    return None


def main() -> None:
    args = parse_args()

    with open(args.source_path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        emitted = 0

        for row_number, row in enumerate(reader, start=2):
            source_target_id = normalize_text(row.get("ID"))
            name = normalize_text(row.get("Name"))
            if source_target_id is None or name is None:
                emit_error("Missing required target ID or name", row_number)
                continue

            record = {
                "source_target_id": source_target_id,
                "name": name,
                "gene_name": normalize_text(row.get("Gene Name")),
                "genbank_protein_id": normalize_text(row.get("GenBank Protein ID")),
                "genbank_gene_id": normalize_text(row.get("GenBank Gene ID")),
                "uniprot_id": normalize_text(row.get("UniProt ID")),
                "uniprot_title": normalize_text(row.get("Uniprot Title")),
                "pdb_ids": split_multi_value(normalize_text(row.get("PDB ID"))),
                "gene_card_id": normalize_text(row.get("GeneCard ID")),
                "gen_atlas_id": normalize_text(row.get("GenAtlas ID")),
                "hgnc_id": normalize_text(row.get("HGNC ID")),
                "species": normalize_text(row.get("Species")),
                "drugbank_ids": split_multi_value(normalize_text(row.get("Drug IDs"))),
                "actions": split_multi_value(
                    get_first_value(row, "Actions", "Action")
                ),
                "known_action": get_first_value(
                    row, "Known Action", "Known action"
                ),
            }

            emit_record(record)
            emitted += 1
            if args.limit is not None and emitted >= args.limit:
                break


if __name__ == "__main__":
    main()

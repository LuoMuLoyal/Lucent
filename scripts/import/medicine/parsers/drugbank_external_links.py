from __future__ import annotations

import argparse
import csv
import json

from common import emit_error, emit_record, normalize_text, stable_uuid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    with open(args.source_path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        emitted = 0

        for row_number, row in enumerate(reader, start=2):
            drugbank_id = normalize_text(row.get("DrugBank ID"))
            if drugbank_id is None:
                emit_error("Missing required DrugBank ID", row_number)
                continue

            row_fingerprint = json.dumps(row, ensure_ascii=False, sort_keys=True)
            record = {
                "id": stable_uuid(
                    "drugbank_external_links", drugbank_id, row_fingerprint
                ),
                "drugbank_id": drugbank_id,
                "drug_name": normalize_text(row.get("Name")),
                "cas_number": normalize_text(row.get("CAS Number")),
                "drug_type": normalize_text(row.get("Drug Type")),
                "kegg_compound_id": normalize_text(row.get("KEGG Compound ID")),
                "kegg_drug_id": normalize_text(row.get("KEGG Drug ID")),
                "pubchem_compound_id": normalize_text(
                    row.get("PubChem Compound ID")
                ),
                "pubchem_substance_id": normalize_text(
                    row.get("PubChem Substance ID")
                ),
                "chebi_id": normalize_text(row.get("ChEBI ID")),
                "pharmgkb_id": normalize_text(row.get("PharmGKB ID")),
                "het_id": normalize_text(row.get("HET ID")),
                "uniprot_id": normalize_text(row.get("UniProt ID")),
                "uniprot_title": normalize_text(row.get("UniProt Title")),
                "genbank_id": normalize_text(row.get("GenBank ID")),
                "dpd_id": normalize_text(row.get("DPD ID")),
                "rxlist_link": normalize_text(row.get("RxList Link")),
                "pdrhealth_link": normalize_text(row.get("Pdrhealth Link")),
                "wikipedia_id": normalize_text(row.get("Wikipedia ID")),
                "drugs_com_link": normalize_text(row.get("Drugs.com Link")),
                "ndc_id": normalize_text(row.get("NDC ID")),
            }

            emit_record(record)
            emitted += 1
            if args.limit is not None and emitted >= args.limit:
                break


if __name__ == "__main__":
    main()

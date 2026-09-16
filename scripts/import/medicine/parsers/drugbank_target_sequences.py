"""Parses DrugBank target protein / gene FASTA files.

Both `protein.fasta` and `gene.fasta` use the same header shape:

    >drugbank_target|<uniprotId> <target name> (<DBxxxxx>; <DByyyyy>; ...)

They hold different data for the same target — amino-acid sequence vs the coding
nucleotide sequence — so the caller must say which one this is through
`--dataset`. The value becomes the record's `source_dataset`, which is what keeps
the two apart under the table's `(source_dataset, uniprot_id)` unique key.
"""

from __future__ import annotations

import argparse

from common import emit_error, emit_record, normalize_text, stable_uuid

HEADER_PREFIX = "drugbank_target|"

# The trailing parenthetical carries the DrugBank ids this target belongs to.
# Reaching it with a regex rather than splitting on "(" avoids mangling names
# that contain brackets of their own.
_ALLOWED_DATASETS = ("protein_fasta", "gene_fasta")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--source-dataset", required=True, choices=_ALLOWED_DATASETS)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def split_header(header: str) -> tuple[str, str | None, list[str]] | None:
    """Splits a header (without the leading `>`) into id, name, drug ids."""
    body = header.strip()
    if body.startswith(HEADER_PREFIX):
        body = body[len(HEADER_PREFIX) :].strip()

    uniprot_id, _, rest = body.partition(" ")
    uniprot_id = normalize_text(uniprot_id)
    if uniprot_id is None:
        return None

    rest = rest.strip()
    drugbank_ids: list[str] = []
    name = rest

    # Only treat a trailing parenthetical as the drug list when it closes the
    # header; a name may legitimately contain an unmatched bracket.
    if rest.endswith(")"):
        opening = rest.rfind("(")
        if opening != -1:
            inner = rest[opening + 1 : -1]
            name = rest[:opening].strip()
            for part in inner.replace(",", ";").split(";"):
                candidate = normalize_text(part)
                if candidate is not None:
                    drugbank_ids.append(candidate)

    return uniprot_id, normalize_text(name), drugbank_ids


def main() -> None:
    args = parse_args()
    emitted = 0
    entry_index = 0

    with open(args.source_path, encoding="utf-8", errors="replace") as handle:
        header: str | None = None
        chunks: list[str] = []

        def flush() -> bool:
            """Emits the buffered entry. Returns False when it was rejected."""
            nonlocal emitted, entry_index
            if header is None:
                return True

            entry_index += 1
            parsed = split_header(header)
            if parsed is None:
                emit_error("Missing UniProt id in FASTA header", entry_index)
                return True

            uniprot_id, target_name, drugbank_ids = parsed
            sequence = "".join(chunks).replace(" ", "").strip()
            if not sequence:
                emit_error(f"Empty sequence for {uniprot_id}", entry_index)
                return True

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_target_sequence", args.source_dataset, uniprot_id
                    ),
                    "source_dataset": args.source_dataset,
                    "uniprot_id": uniprot_id,
                    "target_name": target_name,
                    "drugbank_ids": drugbank_ids or None,
                    "sequence": sequence,
                    "length": len(sequence),
                }
            )
            emitted += 1

            return not (args.limit is not None and emitted >= args.limit)

        for raw_line in handle:
            line = raw_line.rstrip("\r\n")
            if line.startswith(">"):
                if not flush():
                    return
                header = line[1:]
                chunks = []
            elif header is not None:
                chunks.append(line.strip())

        flush()


if __name__ == "__main__":
    main()

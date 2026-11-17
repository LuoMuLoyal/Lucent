"""Parses `drug sequences.fasta` (biotech drug sequences).

Header shape:

    >drugbank_drug|<DBxxxxx> <drug name> <chain description>

One drug may own several entries — 335 drugs account for 615 records and the
largest has 11 (heavy/light chains, subunits) — so the chain description is part
of the natural key. The description is kept verbatim rather than split into
name/chain columns: the real vocabulary is open-ended (`sequence`, `heavy chain`,
`SUBUNIT_1`, `(FSH)`, ...), so any split would silently mangle values.
"""

from __future__ import annotations

import argparse

from common import emit_error, emit_record, normalize_text, stable_uuid

HEADER_PREFIX = "drugbank_drug|"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def split_header(header: str) -> tuple[str, str | None] | None:
    """Splits a header (without the leading `>`) into (drugbankId, description)."""
    body = header.strip()
    if body.startswith(HEADER_PREFIX):
        body = body[len(HEADER_PREFIX) :].strip()

    drugbank_id, _, description = body.partition(" ")
    drugbank_id = normalize_text(drugbank_id)
    if drugbank_id is None:
        return None

    return drugbank_id, normalize_text(description)


def main() -> None:
    args = parse_args()
    emitted = 0
    entry_index = 0

    with open(args.source_path, encoding="utf-8", errors="replace") as handle:
        header: str | None = None
        chunks: list[str] = []

        def flush() -> bool:
            """Emits the buffered entry. Returns False once the limit is hit."""
            nonlocal emitted, entry_index
            if header is None:
                return True

            entry_index += 1
            parsed = split_header(header)
            if parsed is None:
                emit_error("Missing DrugBank id in FASTA header", entry_index)
                return True

            drugbank_id, description = parsed
            if description is None:
                # Without a description the row cannot be told apart from the
                # drug's other chains under the (drugbank_id, description) key.
                emit_error(f"Missing chain description for {drugbank_id}", entry_index)
                return True

            sequence = "".join(chunks).replace(" ", "").strip()
            if not sequence:
                emit_error(f"Empty sequence for {drugbank_id}", entry_index)
                return True

            emit_record(
                {
                    "id": stable_uuid(
                        "drugbank_drug_sequence", drugbank_id, description
                    ),
                    "drugbank_id": drugbank_id,
                    "description": description,
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

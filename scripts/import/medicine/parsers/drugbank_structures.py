"""Parses `structures.sdf` (DrugBank computed structure descriptors).

Only the fields `drugbank_drugs` does not already carry from the XML are
emitted, plus the chemistry descriptors that exist nowhere else. See the
`drugbank_structures` model comment for why `JCHEM_TRADITIONAL_IUPAC` and the
duplicated list fields are left out.

SDF shape: a header/molblock section, then `> <FIELD>` lines each followed by the
value, terminated by `$$$$`. Values may span several lines (up to a blank line),
which is why the reader buffers until the next marker rather than taking one
line per field.
"""

from __future__ import annotations

import argparse
import math
import re

from common import emit_error, emit_record, normalize_text

# `> <FIELD_NAME>` / `>  <FIELD_NAME>` / `><FIELD_NAME>`
_FIELD_MARKER = re.compile(r"^>\s*<([^>]+)>")
_RECORD_END = "$$$$"

# text field -> emitted column
_TEXT_FIELDS = {
    "SMILES": "smiles",
    "INCHI_IDENTIFIER": "inchi_identifier",
    "INCHI_KEY": "inchi_key",
    "FORMULA": "formula",
    "JCHEM_IUPAC": "jchem_iupac",
    "ALOGPS_SOLUBILITY": "alogps_solubility",
}

# integer field -> emitted column
_INT_FIELDS = {
    "JCHEM_ATOM_COUNT": "jchem_atom_count",
    "JCHEM_FORMAL_CHARGE": "jchem_formal_charge",
    "JCHEM_GHOSE_FILTER": "jchem_ghose_filter",
    "JCHEM_RULE_OF_FIVE": "jchem_rule_of_five",
    "JCHEM_ACCEPTOR_COUNT": "jchem_acceptor_count",
    "JCHEM_DONOR_COUNT": "jchem_donor_count",
    "JCHEM_BIOAVAILABILITY": "jchem_bioavailability",
    "JCHEM_MDDR_LIKE_RULE": "jchem_mddr_like_rule",
    "JCHEM_NUMBER_OF_RINGS": "jchem_number_of_rings",
    "JCHEM_ROTATABLE_BOND_COUNT": "jchem_rotatable_bond_count",
    "JCHEM_VEBER_RULE": "jchem_veber_rule",
    "JCHEM_PHYSIOLOGICAL_CHARGE": "jchem_physiological_charge",
    "JCHEM_NEUTRAL_CHARGE": "jchem_neutral_charge",
}

# float field -> emitted column
_FLOAT_FIELDS = {
    "MOLECULAR_WEIGHT": "molecular_weight",
    "EXACT_MASS": "exact_mass",
    "JCHEM_AVERAGE_POLARIZABILITY": "jchem_average_polarizability",
    "JCHEM_POLAR_SURFACE_AREA": "jchem_polar_surface_area",
    "JCHEM_REFRACTIVITY": "jchem_refractivity",
    "JCHEM_LOGP": "jchem_logp",
    "JCHEM_PKA": "jchem_pka",
    "JCHEM_PKA_STRONGEST_ACIDIC": "jchem_pka_strongest_acidic",
    "JCHEM_PKA_STRONGEST_BASIC": "jchem_pka_strongest_basic",
    "JCHEM_AVERAGE_NEUTRAL_MICROSPECIES_CHARGE": (
        "jchem_average_neutral_microspecies_charge"
    ),
    "ALOGPS_LOGP": "alogps_logp",
    "ALOGPS_LOGS": "alogps_logs",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def split_list(value: str | None) -> list[str] | None:
    """Splits a semicolon-separated SDF list value."""
    text = normalize_text(value)
    if text is None:
        return None

    items = [part.strip() for part in text.replace("\n", " ").split(";")]
    items = [item for item in items if item]
    return items or None


def as_int(value: str | None) -> int | None:
    text = normalize_text(value)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def as_float(value: str | None) -> float | None:
    text = normalize_text(value)
    if text is None:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    # Reject non-finite values: the source writes a literal "NaN" for a couple
    # of pKa cells, and `json.dumps` would emit a bare `NaN` token that no JSON
    # reader accepts. A NaN descriptor means "no value", not a number.
    return parsed if math.isfinite(parsed) else None


def build_record(fields: dict[str, str], record_number: int) -> dict[str, object] | None:
    drugbank_id = normalize_text(fields.get("DRUGBANK_ID"))
    if drugbank_id is None:
        emit_error("Missing DRUGBANK_ID in SDF record", record_number)
        return None

    record: dict[str, object] = {"drugbank_id": drugbank_id}

    for source, column in _TEXT_FIELDS.items():
        record[column] = normalize_text(fields.get(source))

    for source, column in _INT_FIELDS.items():
        record[column] = as_int(fields.get(source))

    for source, column in _FLOAT_FIELDS.items():
        record[column] = as_float(fields.get(source))

    record["salts"] = split_list(fields.get("SALTS"))

    # A record whose descriptors all failed to parse carries nothing worth
    # storing beyond the id; skip it rather than writing an empty shell.
    if all(value is None for key, value in record.items() if key != "drugbank_id"):
        emit_error(f"SDF record has no usable descriptors for {drugbank_id}", record_number)
        return None

    return record


def main() -> None:
    args = parse_args()
    emitted = 0
    record_number = 0

    with open(args.source_path, encoding="utf-8", errors="replace") as handle:
        fields: dict[str, str] = {}
        current: str | None = None

        def flush() -> bool:
            """Emits the buffered record. Returns False once the limit is hit."""
            nonlocal emitted, record_number
            if not fields:
                return True

            record_number += 1
            record = build_record(fields, record_number)
            if record is not None:
                emit_record(record)
                emitted += 1

            return not (args.limit is not None and emitted >= args.limit)

        for raw_line in handle:
            line = raw_line.rstrip("\r\n")

            if line.strip() == _RECORD_END:
                if not flush():
                    return
                fields = {}
                current = None
                continue

            marker = _FIELD_MARKER.match(line)
            if marker:
                current = marker.group(1).strip()
                fields[current] = ""
                continue

            if current is not None:
                # The molblock/header above the first marker has no owner and
                # is ignored; only marked fields are captured.
                fields[current] = (
                    f"{fields[current]}\n{line}" if fields[current] else line
                )

        flush()


if __name__ == "__main__":
    main()

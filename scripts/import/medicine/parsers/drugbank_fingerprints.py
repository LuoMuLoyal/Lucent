"""Computes Morgan fingerprints for every molecule in DrugBank's SDF.

Output is one JSONL record per molecule on stdout, consumed by the same TS
importer as the other parsers:

    {"drugbank_id": "DB00001", "fingerprint": "<512 hex chars>", "bit_count": 64}

Why 2048 bits, radius 2: that is the conventional Morgan/ECFP4 setting and the
one every published Tanimoto threshold is calibrated against. Choosing a smaller
fingerprint to save space would change similarity scores in ways published
cutoffs no longer describe.

Why hex and not base64: the value is stored as text and compared with PostgreSQL
bit-string functions once cast, so a hex string round-trips without ambiguity.

The SDF is 2D only (all conformer z coordinates are 0). RDKit parses it fine for
topology-based fingerprints — no 3D information is needed or present.
"""

from __future__ import annotations

import argparse
import json
import sys

from common import emit_error, emit_record, normalize_text

FINGERPRINT_RADIUS = 2
FINGERPRINT_BITS = 2048


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--only-ids",
        help=(
            "Path to a newline-delimited list of DrugBank IDs to emit. The SDF "
            "and the parquet are ordered differently and the SDF only covers "
            "molecules that have a structure, so limiting by SDF position "
            "selects a different drug set than the parent drug import — which "
            "breaks the `drugbank_drugs` foreign key. Pass the IDs already "
            "loaded instead."
        ),
    )
    return parser.parse_args()


def load_allowed_ids(path: str | None) -> set[str] | None:
    """Reads the optional allow-list, or None when unrestricted.

    An empty string is treated as "not provided": the dataset registry always
    passes the flag, substituting the environment value only when it is set.
    """
    if not path or not path.strip():
        return None
    with open(path, encoding="utf-8") as handle:
        return {line.strip() for line in handle if line.strip()}


def main() -> None:
    args = parse_args()

    try:
        from rdkit import Chem, RDLogger
        from rdkit.Chem import rdFingerprintGenerator
    except ImportError:
        emit_error(
            "RDKit is required to compute fingerprints. "
            "Install it with: pip install rdkit",
            None,
        )
        sys.exit(1)

    allowed_ids = load_allowed_ids(args.only_ids)

    # RDKit writes parse warnings to stderr for every imperfect molecule; the
    # corpus has thousands and the noise buries real errors.
    RDLogger.DisableLog("rdApp.*")

    generator = rdFingerprintGenerator.GetMorganGenerator(
        radius=FINGERPRINT_RADIUS, fpSize=FINGERPRINT_BITS
    )

    supplier = Chem.SDMolSupplier(args.source_path, sanitize=True, removeHs=False)

    emitted = 0
    unparsed = 0
    for index, molecule in enumerate(supplier):
        if args.limit is not None and emitted >= args.limit:
            break

        if molecule is None:
            unparsed += 1
            emit_error("SDF record could not be parsed", index + 1)
            continue

        # The SDF tags the DrugBank identifier as DATABASE_ID (verified in the
        # corpus), not DRUGBANK_ID. Fall back to the molfile name for records
        # whose data block is truncated.
        drugbank_id = None
        for prop in ("DATABASE_ID", "_Name"):
            if molecule.HasProp(prop):
                drugbank_id = normalize_text(molecule.GetProp(prop))
                if drugbank_id:
                    break
        if drugbank_id is None:
            emit_error("SDF record without DrugBank ID", index + 1)
            continue

        if allowed_ids is not None and drugbank_id not in allowed_ids:
            continue

        fingerprint = generator.GetFingerprint(molecule)
        # ToBitString() yields "1"/"0" characters in fingerprint order; packing
        # it to hex keeps 2048 bits in 512 characters.
        bits = fingerprint.ToBitString()
        as_int = int(bits, 2)
        hex_value = format(as_int, f"0{FINGERPRINT_BITS // 4}x")

        emit_record(
            {
                "drugbank_id": drugbank_id,
                "fingerprint": hex_value,
                "bit_count": fingerprint.GetNumOnBits(),
                "radius": FINGERPRINT_RADIUS,
                "n_bits": FINGERPRINT_BITS,
            }
        )
        emitted += 1

    if unparsed:
        emit_error(f"{unparsed} SDF records could not be parsed", None)


if __name__ == "__main__":
    main()

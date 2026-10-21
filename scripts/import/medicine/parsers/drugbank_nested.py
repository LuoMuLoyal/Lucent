"""Shared helpers for the DrugBank "nested list" parquet columns.

DrugBank's CSV companion export collapses repeated child rows into one JSON cell
per drug. The resulting shape is **inconsistent across rows** for the same
column:

    patents                -> {"patent": {...}}                 (204 drugs)
                           -> {"patent": [{...}, {...}]}         (330 drugs)
    experimental_properties-> {"property": [{...}, ...]}         (1,922 drugs)
                           -> {"property": {...}}                (742 drugs)
    pathways               -> {"pathway": {...}}                 (385 drugs)
                           -> {"pathway": [{...}, ...]}          (7 drugs)
    reactions              -> {"reaction": [{...}, ...]}         (506 drugs)
                           -> {"reaction": {...}}                (290 drugs)

A single-element child is emitted as a bare object, several as an array. Any
parser that assumes one or the other silently drops rows — `patent=dict` alone
is 204 drugs. Every accessor below normalises to a list first.

The same applies to `snp_effects` (`effect`) and
`snp_adverse_drug_reactions` (`reaction`).
"""

from __future__ import annotations

import json
from typing import Any

from common import normalize_text


def unwrap_list(cell: Any, key: str) -> list[dict[str, Any]]:
    """Returns the child records of a nested cell as a list, always.

    Accepts the raw parquet cell (a JSON string or None) and the name of the
    child key (`patent`, `property`, `pathway`, `reaction`, `effect`).
    A missing / empty / unparseable cell yields an empty list, never an error.
    """
    if cell is None:
        return []

    raw = cell
    if isinstance(cell, str):
        text = cell.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []

    if not isinstance(raw, dict):
        return []

    child = raw.get(key)
    if child is None:
        return []
    if isinstance(child, dict):
        return [child]
    if isinstance(child, list):
        return [item for item in child if isinstance(item, dict)]
    return []


def text_of(record: dict[str, Any], *keys: str) -> str | None:
    """First non-empty value among `keys`, as normalised text."""
    for key in keys:
        value = normalize_text(record.get(key))
        if value is not None:
            return value
    return None


def row_limit_reached(rows_seen: int, limit: int | None) -> bool:
    """Whether `--limit` source rows have been consumed.

    `--limit` counts **source rows**, matching every other medicine import
    command (`drugbank-drugs --limit 100` reads the first 100 drugs). A
    one-to-many parser that counted emitted child rows instead would cover a
    different, larger set of drugs than the parent import — enough to trip the
    `drugbank_drugs` foreign key when the two runs are compared.
    """
    return limit is not None and rows_seen >= limit

from __future__ import annotations

import json
import re
import sys
import uuid
from typing import Any, Iterable


UUID_NAMESPACE = uuid.UUID("de7a467d-e130-491c-b529-8fd3409a9156")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def normalize_name(value: Any) -> str | None:
    text = normalize_text(value)
    if text is None:
        return None
    normalized = re.sub(r"\s+", "", text)
    return normalized or None


def normalize_list(values: Iterable[str | None]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()

    for value in values:
        normalized = normalize_text(value)
        if normalized is None:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)

    return unique


def build_search_text(values: Iterable[str | None]) -> str | None:
    normalized = normalize_list(values)
    return " ".join(normalized) if normalized else None


def stable_uuid(*parts: Any) -> str:
    normalized_parts = [normalize_text(part) or "" for part in parts]
    return str(uuid.uuid5(UUID_NAMESPACE, "||".join(normalized_parts)))


def to_float(value: Any) -> float | None:
    if value is None:
        return None

    text = str(value).strip()
    if text == "":
        return None

    try:
        return float(text)
    except ValueError:
        return None


def emit_record(data: dict[str, Any]) -> None:
    print(json.dumps({"kind": "record", "data": data}, ensure_ascii=False))


def emit_error(message: str, row_number: int | None = None) -> None:
    payload = {
        "kind": "error",
        "message": message,
        "rowNumber": row_number,
    }
    print(json.dumps(payload, ensure_ascii=False))

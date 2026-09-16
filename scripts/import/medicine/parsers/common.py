from __future__ import annotations

import html
import json
import re
import sys
import uuid
from typing import Any, Iterable


UUID_NAMESPACE = uuid.UUID("5be2a845-7190-4c91-b7dd-f4e6a5b470bf")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


# --- Narrative text cleaning -------------------------------------------------
#
# DrugBank narrative fields (`description`, `indication`, `mechanism-of-action`,
# `toxicity`, ...) ship raw XML entities and inline markup, e.g.
#   "The intravenous LD&lt;sub&gt;50&lt;/sub&gt; is ..."   → subscript
#   "**Indicated** for:[label,L6616]&#13;"                → pseudo-Markdown
# Without cleaning these render verbatim as `&lt;sub&gt;` / `&#13;` / `**` in
# the client. `clean_narrative_text` is applied only to prose fields; identifier
# / URL fields keep going through `normalize_text` so their content is never
# rewritten.

# Database reference markers such as `[label,L6616]` / `[L41539]`.
_REFERENCE_MARKER = re.compile(r"\[[A-Za-z_]*\s*,?\s*[A-Z]?\d{3,}\]")
# Standalone bracketed cross-references to other DrugBank entities, e.g.
# "[vitamin K]" / "[aspirin]" — the brackets are markup, the words are content.
_INLINE_LINK = re.compile(r"\[([^\[\]]{1,80})\]")
# Markdown-ish emphasis that DrugBank embeds in a few fields.
_EMPHASIS = re.compile(r"\*{1,3}(?=\S)(.+?)(?<=\S)\*{1,3}", re.DOTALL)
# HTML line-break / paragraph tags.
_BREAK_TAG = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_BLOCK_TAG = re.compile(
    r"</?\s*(p|div|li|ul|ol|tr|table|h[1-6])\b[^>]*>", re.IGNORECASE
)
# Any residual tag, including sub/sup which carry no plain-text meaning.
_ANY_TAG = re.compile(r"</?\s*[A-Za-z][A-Za-z0-9]*\b[^>]*>")
# Collapse runs of horizontal whitespace but keep intentional newlines.
_HSPACE = re.compile(r"[ \t\u00a0\u200b]+")
# Collapse 3+ blank lines down to a single blank-line separator.
_BLANKLINES = re.compile(r"\n{3,}")


def clean_narrative_text(value: Any) -> str | None:
    """Decode entities and strip inline markup from DrugBank prose fields.

    Order matters: entity decoding must happen before tag stripping so that
    `&lt;sub&gt;` collapses together with a literal `<sub>`.
    """
    text = normalize_text(value)
    if text is None:
        return None

    text = html.unescape(text)
    text = _BREAK_TAG.sub("\n", text)
    text = _BLOCK_TAG.sub("\n", text)
    text = _ANY_TAG.sub("", text)
    text = _REFERENCE_MARKER.sub("", text)
    text = _EMPHASIS.sub(r"\1", text)
    # Unwrap remaining bracketed links to their label after reference markers
    # were removed, so `[aspirin]` becomes `aspirin`.
    text = _INLINE_LINK.sub(r"\1", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _HSPACE.sub(" ", text)
    # Normalize per-line padding, then collapse excess blank lines.
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANKLINES.sub("\n\n", text)
    return normalize_text(text)


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


def emit_record(data: dict[str, Any]) -> None:
    print(json.dumps({"kind": "record", "data": data}, ensure_ascii=False))


def emit_error(message: str, row_number: int | None = None) -> None:
    payload = {
        "kind": "error",
        "message": message,
        "rowNumber": row_number,
    }
    print(json.dumps(payload, ensure_ascii=False))


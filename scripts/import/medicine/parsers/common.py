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

# Database reference codes: `L6616`, `A31973`, `APRD01028`, `EXPT02967`, and the
# occasional short form `A15` / `F61` — hence two digits, not three.
# The leading letters are required on purpose — a bare run of digits would make
# `[100 mg]` or `[P450 enzymes]` look like a marker and eat real prose.
_CODE = r"[A-Z]{1,5}\d{2,}"
# Reference markers, as they actually appear in the corpus:
#   `[L6616]`                          single code
#   `[label,L6616]`                    label + code
#   `[L45859,A4393]`                   several codes
#   `[FDA label, A31973, A31976]`      label + several codes
# The first pattern only covered the first two. Everything else fell through to
# `_INLINE_LINK`, which unwrapped the brackets and left the codes sitting in the
# prose as if they were words (`...cell death.A264349, L51254`) — 3,567 fields
# across the corpus.
_REFERENCE_MARKER = re.compile(
    r"\[\s*(?:[A-Za-z][A-Za-z ]{0,24}[,\s]+)?"
    + _CODE
    + r"(?:\s*,\s*"
    + _CODE
    + r")*\s*\]"
)
# A few records drop the closing bracket entirely
# (`...cell death.[A19175. >99.5% bound to plasma proteins`). Matched by shape
# rather than by position, then rejected when a `]` turns up just after — that
# is what keeps a bracket introducing real prose (`[P450 enzymes] metabolise`)
# from being treated as a broken marker.
_UNTERMINATED_MARKER = re.compile(
    r"\[\s*(?:[A-Za-z][A-Za-z ]{0,24}[,\s]+)?"
    + _CODE
    + r"(?:\s*,\s*"
    + _CODE
    + r")*(?=[\s.,;:]|$)"
)
# How far ahead to look for the closing bracket that marks a span as real prose.
_UNTERMINATED_LOOKAHEAD = 40
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


def _drop_unterminated_marker(match: re.Match[str]) -> str:
    """Removes a marker-shaped span only when no closing bracket follows.

    A `]` a few characters later means the bracket was introducing real prose
    (`[P450 enzymes] metabolise it`) rather than a broken reference marker.
    """
    tail = match.string[match.end() : match.end() + _UNTERMINATED_LOOKAHEAD]
    return match.group(0) if "]" in tail else ""


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
    text = _UNTERMINATED_MARKER.sub(_drop_unterminated_marker, text)
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


"""Safety guard and error classification for caller-supplied Cypher.

Lucent generates Cypher from natural language with its own model; this service
is the "validate and execute" half of that loop, so every statement it runs was
written somewhere else. This module decides whether a statement may run at all,
and turns whatever AGE reports back into one of a small, fixed set of error
kinds that the caller can feed to its model for a retry.

Two rules are enforced, because the statement is not ours:

* **One statement only.** A second statement is a way to smuggle a write past a
  scan of the first, so anything but a single trailing ``;`` is refused.
* **Read-only clauses only.** Decided by a keyword scan over the statement with
  string literals, quoted identifiers and comments blanked out first, so
  ``RETURN 'delete this' AS note`` is a projection and not a ``DELETE``.

The scan is textual rather than a parser: this service has no Cypher parser and
AGE's own parser is the real authority on syntax. The scan's job is narrower —
refuse the constructs that write, and refuse the ones AGE 1.7 does not
implement (``docs/VERIFICATION.md`` records the subset that was measured
against a live database).

Because AGE's own errors reach us wrapped (semantica raises ``ProcessingError``
with the driver's message embedded), classification reads the whole exception
chain — type names and messages — rather than a single exception type.
"""

from __future__ import annotations

import re
from typing import Literal

# The fixed vocabulary callers retry on. Nothing else may be reported.
QueryErrorKind = Literal[
    "not_read_only",
    "multiple_statements",
    "syntax_error",
    "unsupported_feature",
    "timeout",
    "internal",
]

# A refusal: the kind to report and the message to hand back to the caller.
QueryProblem = tuple[QueryErrorKind, str]

# Clauses a read-only statement may begin with, after leading comments and
# whitespace are removed. Anything else — CREATE, CALL, EXPLAIN, SHOW — is
# refused, which is what keeps a write from hiding behind an unexpected opening.
_READ_ONLY_STARTS = frozenset({"MATCH", "OPTIONAL", "WITH", "UNWIND", "RETURN"})

# Clauses that write to the graph or the server, or that run code this guard
# cannot see into. Matched as whole words: `CREATED` and `status` are identifiers,
# not keywords.
_WRITE_KEYWORDS = (
    "ALTER",
    "CALL",
    "COPY",
    "CREATE",
    "DELETE",
    "DETACH",
    "DROP",
    "GRANT",
    "LOAD",
    "MERGE",
    "REMOVE",
    "REVOKE",
    "SET",
    "TRUNCATE",
    "VACUUM",
)
_WRITE_RE = re.compile(r"\b(?:" + "|".join(_WRITE_KEYWORDS) + r")\b")

# A `$name` parameter placeholder is a name, not a clause: `$delete` is a
# legitimate placeholder and must not read as a DELETE.
_PARAM_RE = re.compile(r"\$[A-Za-z_]\w*")
_FIRST_WORD_RE = re.compile(r"[A-Za-z_]\w*")

_MSG_SHORTEST_PATH = "AGE has no shortestPath; write an explicit typed multi-hop pattern instead"
_MSG_MULTI_TYPE = "AGE does not support multi-type edges; split into one pattern per type"
_MSG_DATETIME = "AGE 1.7 has no datetime(); compare stored string dates instead"

# Constructs AGE 1.7 does not implement, detected in the submitted statement
# before it reaches the database. Patterns run over the blanked-out statement,
# so `RETURN 'datetime(' AS note` stays a projection.
_UNSUPPORTED_SYNTAX: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\b(?:shortestpath|allshortestpaths)\s*\(", re.IGNORECASE),
        _MSG_SHORTEST_PATH,
    ),
    (
        # `[r:A|B]` and `[:A|B]` — a pipe between labels inside one bracket.
        # A list comprehension uses `|` too but never has a colon before it.
        re.compile(r"\[[^][:]*:[^][]*\|"),
        _MSG_MULTI_TYPE,
    ),
    (re.compile(r"\bdatetime\s*\(", re.IGNORECASE), _MSG_DATETIME),
)

# The same constructs as AGE names them when it is the one that rejects them.
# Both directions are checked because AGE reports some of these as a parse
# error and others as an unknown function, and the exact wording varies.
_UNSUPPORTED_ERROR_TEXT: tuple[tuple[tuple[str, ...], str], ...] = (
    (("shortestpath", "allshortestpaths"), _MSG_SHORTEST_PATH),
    (("multi-type", "multiple relationship types", "multiple types"), _MSG_MULTI_TYPE),
    (("datetime",), _MSG_DATETIME),
)

_MSG_MULTIPLE = (
    "Send exactly one Cypher statement; only a single trailing ';' is allowed. "
    "Two statements cannot be validated as read-only together."
)
_MSG_EMPTY = (
    "The statement is empty once comments and whitespace are removed; send a read-only "
    "statement starting with MATCH, OPTIONAL, WITH, UNWIND or RETURN."
)
_MSG_WRITE = (
    "{keyword} is not read-only; this endpoint executes read-only statements only. "
    "Remove the {keyword} clause, or make the change where writes are allowed."
)
_MSG_START = (
    "A read-only statement must begin with MATCH, OPTIONAL, WITH, UNWIND or RETURN; "
    "this one begins with {found}."
)
_MSG_TIMEOUT = (
    "The query was cancelled by the server's statement_timeout. Narrow the pattern "
    "(avoid unbounded variable-length paths) or reduce the result set, then retry."
)

# A message is caller-facing, so it is kept short and never carries a stack
# trace. Any credential-shaped text is redacted even though a psycopg2 message
# does not normally contain the DSN: the cost of being wrong is a leaked
# password in a caller's logs.
_MAX_MESSAGE = 300
_PASSWORD_RE = re.compile(r"(?i)(password\s*=\s*)\S+")
_DSN_CREDENTIALS_RE = re.compile(r"://[^/\s:@]+:[^/\s@]+@")


def _scrub(text: str) -> str:
    """Redact credential-shaped text from a message."""
    return _DSN_CREDENTIALS_RE.sub("://***:***@", _PASSWORD_RE.sub(r"\1***", text))


def _one_line(text: str, limit: int = _MAX_MESSAGE) -> str:
    """Collapse a database message to its first non-empty line, capped in length."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return _scrub(stripped[:limit])
    return "no detail reported"


def strip_literals_and_comments(cypher: str) -> str:
    """Blank out string literals, quoted identifiers and comments.

    Removed characters become spaces rather than disappearing, and newlines are
    kept, so the result has the *same length and layout* as the input: a
    character offset in the scan is a character offset in the statement. Keyword
    scanning then cannot be fooled by ``RETURN 'delete this' AS note``, and two
    tokens can never be joined into one by a removal.

    Handles single- and double-quoted strings, backtick-quoted identifiers,
    ``//`` line comments and ``/* */`` block comments. An unterminated literal
    or block comment blanks the rest of the statement, which leaves the
    surviving keywords visible to the guard.
    """
    chars = list(cypher)
    length = len(chars)
    index = 0

    def blank(start: int, stop: int) -> None:
        for position in range(start, min(stop, length)):
            if chars[position] != "\n":
                chars[position] = " "

    while index < length:
        char = chars[index]
        following = chars[index + 1] if index + 1 < length else ""
        if char in {"'", '"', "`"}:
            end = index + 1
            while end < length:
                if chars[end] == "\\":
                    end += 2
                    continue
                if chars[end] == char:
                    end += 1
                    break
                end += 1
            blank(index, end)
            index = max(end, index + 1)
        elif char == "/" and following == "/":
            end = cypher.find("\n", index)
            end = length if end == -1 else end
            blank(index, end)
            index = end
        elif char == "/" and following == "*":
            end = cypher.find("*/", index + 2)
            end = length if end == -1 else end + 2
            blank(index, end)
            index = end
        else:
            index += 1

    return "".join(chars)


def normalize_statement(cypher: str) -> str:
    """Return the statement as it is handed to AGE.

    Leading and trailing whitespace goes, and a single trailing ``;`` with it:
    AGE's ``cypher()`` takes one statement, and a separator is not part of it.
    Comments after the terminator go too, for the same reason.

    Only call this on a statement :func:`check_read_only` has accepted; it does
    not re-validate anything.
    """
    scan = strip_literals_and_comments(cypher)
    if scan.strip().endswith(";"):
        # Blanking preserves offsets, so the last ';' in the scan is the last
        # ';' in the original text and the cut is exact.
        return cypher[: scan.rindex(";")].strip()
    return cypher.strip()


def check_read_only(cypher: str) -> QueryProblem | None:
    """Refuse anything that is not a single read-only Cypher statement.

    Returns ``None`` when the statement may run, otherwise the ``(kind,
    message)`` pair describing why it may not.

    Precedence, when more than one rule matches: a second statement is reported
    as ``multiple_statements`` (the more specific diagnosis — the caller's fix
    is to send one statement), then a write/admin keyword as ``not_read_only``,
    then the clauses AGE 1.7 cannot run as ``unsupported_feature``.
    """
    scan = strip_literals_and_comments(cypher)
    text = scan.strip()

    semicolons = text.count(";")
    if semicolons and not (semicolons == 1 and text.endswith(";")):
        return ("multiple_statements", _MSG_MULTIPLE)
    if semicolons:
        text = text[:-1].strip()
    if not text:
        return ("not_read_only", _MSG_EMPTY)

    # Placeholders are names: `$delete` is a parameter, not a clause.
    scannable = _PARAM_RE.sub(" ", text)

    write = _WRITE_RE.search(scannable)
    if write is not None:
        keyword = write.group(0).upper()
        return ("not_read_only", _MSG_WRITE.format(keyword=keyword))

    first = _FIRST_WORD_RE.match(scannable)
    if first is None or first.group(0).upper() not in _READ_ONLY_STARTS:
        found = first.group(0) if first is not None else "no keyword"
        return ("not_read_only", _MSG_START.format(found=found))

    for pattern, message in _UNSUPPORTED_SYNTAX:
        if pattern.search(scannable):
            return ("unsupported_feature", message)

    return None


def _chain(error: BaseException, limit: int = 8) -> list[BaseException]:
    """Walk an exception's causes and contexts, outermost first.

    semantica wraps driver errors (``ProcessingError("Query execution
    failed: ...")``) with the original attached as context, so the useful type
    name and message live one or more links down the chain.
    """
    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(chain) < limit:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    return chain


def _innermost_message(error: BaseException) -> str:
    """The database's own words: the deepest message in the exception chain."""
    chain = _chain(error)
    return _one_line(str(chain[-1])) if chain else _one_line(str(error))


def _classify(described: str, message: str) -> QueryProblem:
    """Decide an error kind from a lower-cased description and a message.

    Timeout is checked first: a cancelled statement arrives as an
    ``OperationalError`` subclass, and a caller that retried it as an
    ``internal`` failure would simply time out again.
    """
    if (
        "querycanceled" in described
        or "statement timeout" in described
        or "canceling statement" in described
    ):
        return ("timeout", _MSG_TIMEOUT)

    for needles, text in _UNSUPPORTED_ERROR_TEXT:
        if any(needle in described for needle in needles):
            return ("unsupported_feature", text)

    if "syntax error" in described or "invalid input syntax" in described:
        return (
            "syntax_error",
            f"AGE rejected the Cypher: {_one_line(message)}. "
            "Check the statement against the graph schema.",
        )

    return ("internal", f"Query execution failed: {_one_line(message)}.")


def classify_error(error: BaseException) -> QueryProblem:
    """Map an exception raised while executing a statement onto an error kind.

    The whole chain is read — type names and messages — because semantica wraps
    driver errors in ``ProcessingError`` with the original only reachable as
    context: PostgreSQL's ``QueryCanceled`` is a link down that chain, not the
    exception the caller catches.
    """
    described = " | ".join(f"{type(link).__name__}: {link}" for link in _chain(error)).lower()
    return _classify(described, _innermost_message(error))


def classify_message(message: str) -> QueryProblem:
    """Classify a failure reported as text rather than raised as an exception.

    A store that answers with ``{"success": False, "error": ...}`` gets the same
    vocabulary as one that raises, so the caller's retry loop does not have to
    care which style it is talking to.
    """
    return _classify(message.lower(), message)

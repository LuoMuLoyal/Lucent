"""Structured logging for the service.

The service's interesting failures are quantitative — how many edges a scope
loaded, whether it was truncated, how many facts the fixpoint produced, which
rule was applied. Those are the numbers that decide whether an answer means
anything, and they are useless buried in prose.

Every record therefore carries its values as JSON fields under a fixed ``event``
name. That makes the question that matters answerable from logs alone: *was that
empty result a finding or an empty input?* Two log lines answer it —

    {"event": "export_loaded", "scope": "explicit", "edges": 0, "truncated": false}
    {"event": "reason_finished", "derived": 0, "conclusions": 0}

— where a prose line would have left the reader guessing which of the two
happened.

The format is a deployment choice, so it is a setting: ``LOG_FORMAT=json`` for
machine consumption, ``text`` for a human reading a terminal. Both emit the same
fields, so nothing is lost by switching.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

#: Every record this service emits carries this field, so a log query can select
#: the service's own events without matching on logger names.
EVENT_FIELD = "event"

_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
        "taskName",
    }
)


class JsonFormatter(logging.Formatter):
    """Render a record as one JSON object per line.

    Extra fields passed through ``logger.info(..., extra={...})`` are emitted as
    top-level keys, which is what makes a log line queryable. ``default=str``
    keeps an unexpected value type from turning a log call into an exception:
    logging must not be able to fail a request.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        try:
            return json.dumps(payload, default=str, ensure_ascii=False)
        except (TypeError, ValueError):  # pragma: no cover - default=str covers this
            return json.dumps({"level": record.levelname, "message": record.getMessage()})


class TextFormatter(logging.Formatter):
    """Render a record as a line with its fields appended as ``key=value``."""

    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record, '%H:%M:%S')} {record.levelname:<7} {record.getMessage()}"
        fields = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED and not key.startswith("_")
        }
        if fields:
            rendered = " ".join(f"{key}={_render(value)}" for key, value in sorted(fields.items()))
            base = f"{base}  {rendered}"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        return base


def _render(value: Any) -> str:
    """Render a field value for the text format, quoting only when needed."""
    if isinstance(value, str):
        return f'"{value}"' if " " in value else value
    return str(value)


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Install the service's log handler on the root logger.

    Called once at startup. An unrecognised ``fmt`` falls back to JSON rather
    than raising: a typo in an environment variable should not stop the service
    from starting.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(TextFormatter() if fmt == "text" else JsonFormatter())

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    """Log one structured event.

    ``event`` is the machine-readable name and goes in the message, where log
    tooling already looks for it; the fields carry the numbers.
    """
    logger.info(event, extra={EVENT_FIELD: event, **fields})


def log_level_from_env(default: str = "INFO") -> str:
    """The configured log level, or ``default``."""
    return os.environ.get("LOG_LEVEL", default)


def log_format_from_env(default: str = "json") -> str:
    """The configured log format, or ``default``."""
    return os.environ.get("LOG_FORMAT", default)

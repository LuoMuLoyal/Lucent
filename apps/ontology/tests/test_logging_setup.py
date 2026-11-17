"""Structured logging.

The question these tests exist for is the one this service could not answer
before: was an empty result a finding, or an empty input? That is answerable
only if the numbers are fields rather than prose, so the tests assert the fields
survive to the emitted record — and that logging cannot itself fail a request,
because an observability path that raises is worse than no observability.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from semantica_service.logging_setup import (
    EVENT_FIELD,
    JsonFormatter,
    TextFormatter,
    configure_logging,
    log_event,
)


def _record(**extra: Any) -> logging.LogRecord:
    record = logging.LogRecord(
        name="semantica_service.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="export_loaded",
        args=(),
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


class TestJsonFormat:
    def test_fields_become_top_level_keys(self) -> None:
        """A field buried in prose is not queryable, which is the whole point."""
        line = JsonFormatter().format(_record(event="export_loaded", edges=0, truncated=False))
        payload = json.loads(line)

        assert payload["event"] == "export_loaded"
        assert payload["edges"] == 0
        assert payload["truncated"] is False
        assert payload["message"] == "export_loaded"

    def test_one_line_per_record(self) -> None:
        """A multi-line record breaks line-oriented log shipping."""
        line = JsonFormatter().format(_record(event="x", nested={"a": [1, 2]}))

        assert "\n" not in line

    def test_an_unserialisable_value_does_not_break_the_record(self) -> None:
        """Logging must not be able to fail the request it is describing."""
        line = JsonFormatter().format(_record(event="x", weird=object()))

        assert json.loads(line)["event"] == "x"

    def test_an_exception_is_included(self) -> None:
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = _record(event="x")
            record.exc_info = sys.exc_info()

        payload = json.loads(JsonFormatter().format(record))

        assert "boom" in payload["exception"]

    def test_the_reserved_surface_is_not_duplicated_into_the_payload(self) -> None:
        """`msg`/`levelname` would otherwise shadow the canonical fields."""
        payload = json.loads(JsonFormatter().format(_record()))

        assert "levelname" not in payload
        assert payload["level"] == "INFO"
        assert payload["logger"] == "semantica_service.test"


class TestTextFormat:
    def test_fields_are_appended(self) -> None:
        line = TextFormatter().format(_record(event="export_loaded", edges=541))

        assert "export_loaded" in line
        assert "edges=541" in line
        assert "event=export_loaded" in line

    def test_a_value_with_a_space_is_quoted(self) -> None:
        """Otherwise a field boundary is ambiguous when read back."""
        line = TextFormatter().format(_record(event="x", note="two words"))

        assert 'note="two words"' in line

    def test_both_formats_carry_the_same_fields(self) -> None:
        """Switching format for a human must not lose information."""
        record = _record(event="export_loaded", edges=541, truncated=True)
        text = TextFormatter().format(record)
        payload = json.loads(JsonFormatter().format(record))

        assert "edges=541" in text and payload["edges"] == 541
        assert "truncated=True" in text and payload["truncated"] is True


class TestConfiguration:
    def test_json_is_the_default_format(self) -> None:
        """The useful output is quantitative, so it defaults to machine-readable."""
        configure_logging("INFO", "json")

        assert isinstance(logging.getLogger().handlers[0].formatter, JsonFormatter)

    def test_text_selects_the_text_format(self) -> None:
        configure_logging("INFO", "text")

        handler = logging.getLogger().handlers[0]
        assert isinstance(handler.formatter, TextFormatter)

    def test_an_unknown_format_falls_back_rather_than_raising(self) -> None:
        """A typo in an environment variable must not stop the service starting."""
        configure_logging("INFO", "yaml")

        assert isinstance(logging.getLogger().handlers[0].formatter, JsonFormatter)

    def test_the_level_is_applied(self) -> None:
        configure_logging("DEBUG", "json")

        assert logging.getLogger().level == logging.DEBUG

    def test_reconfiguring_does_not_stack_handlers(self) -> None:
        """Two handlers would emit every line twice."""
        configure_logging("INFO", "json")
        configure_logging("INFO", "text")

        assert len(logging.getLogger().handlers) == 1

    @pytest.fixture(autouse=True)
    def _restore(self) -> Any:
        original = logging.getLogger().level
        yield
        configure_logging(logging.getLevelName(original), "json")


class TestLogEvent:
    def test_the_event_name_travels_as_a_field_and_a_message(self, caplog: Any) -> None:
        """Tooling matches on the message; humans read the field."""
        with caplog.at_level(logging.INFO, logger="semantica_service.test"):
            log_event(logging.getLogger("semantica_service.test"), "reason_finished", facts=0)

        record = caplog.records[-1]
        assert record.getMessage() == "reason_finished"
        assert getattr(record, EVENT_FIELD) == "reason_finished"
        assert record.facts == 0

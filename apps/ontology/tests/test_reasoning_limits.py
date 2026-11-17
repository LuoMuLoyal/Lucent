"""Resource ceilings: the settings have to be observable, not decorative.

`max_reasoning_facts` and `reasoning_timeout_s` were defined but had no call
site, so an operator could set them and see nothing change. These tests pin
that they now refuse work, and that a refusal is structured — a caller has to
tell "too big" from "too slow" to decide whether to retry.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from semantica_service.reasoning import load_library
from semantica_service.reasoning_limits import (
    KIND_FACT_LIMIT,
    KIND_INPUT_TOO_LARGE,
    KIND_TIMEOUT,
    FactBudget,
    check_declared_sizes,
)


def _detail(exc: HTTPException) -> dict[str, Any]:
    """Read the structured refusal out of an exception.

    ``HTTPException.detail`` is annotated ``str`` even though FastAPI passes
    objects through untouched, so the value is read via ``getattr`` rather than
    narrowed — otherwise every test carries an assertion mypy calls
    unreachable, and a real regression would hide behind it.
    """
    detail: Any = getattr(exc, "detail", None)
    assert isinstance(detail, dict), f"refusal was not structured: {detail!r}"
    return detail


def test_a_fact_budget_refuses_an_oversized_result() -> None:
    budget = FactBudget(10)

    with pytest.raises(HTTPException) as caught:
        budget.check(11, source="rules over the loaded fact base")

    assert caught.value.status_code == 422
    detail = _detail(caught.value)
    assert detail["kind"] == KIND_FACT_LIMIT
    assert detail["fact_count"] == 11
    assert detail["max_facts"] == 10


def test_a_result_exactly_at_the_ceiling_is_allowed() -> None:
    """The ceiling is a maximum, not an exclusive bound."""
    FactBudget(10).check(10, source="test")


def test_the_refusal_names_the_size_and_the_setting() -> None:
    """A caller cannot act on "too big" without knowing both numbers."""
    with pytest.raises(HTTPException) as caught:
        FactBudget(5).check(900, source="rules")

    message = str(_detail(caught.value)["message"])
    assert "900" in message
    assert "5" in message
    assert "MAX_REASONING_FACTS" in message


class DeclaredBody:
    """Minimal stand-in for the request model's declared size."""

    def __init__(self, limit: int) -> None:
        self.limit = limit


def test_a_request_declaring_more_than_the_ceiling_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Refusing up front is what keeps the check cheap.

    The alternative is to accept the body, run the rule, and only then notice —
    by which point the whole result set has been materialised in this process.
    """
    from semantica_service.config import get_settings

    monkeypatch.setattr(get_settings(), "max_reasoning_facts", 3)

    with pytest.raises(HTTPException) as caught:
        check_declared_sizes(DeclaredBody(limit=4))

    assert _detail(caught.value)["kind"] == KIND_INPUT_TOO_LARGE


class TestDeadline:
    """A rule that outruns the ceiling is refused, with a structured reason.

    The engine is the database now, so the ceiling is the transaction timeout
    rather than a wall-clock thread join: a query that outruns it comes back as
    ``TimeoutError`` from the pool, and the route has to turn that into
    ``KIND_TIMEOUT`` rather than let it surface as an internal failure. A
    caller has to be able to tell "too big" from "too slow" to know whether to
    narrow the scope or give up.
    """

    def test_a_rule_that_times_out_is_refused_not_reported_as_internal(self) -> None:
        from semantica_service.routes.reason import _run_rule

        class TimingOutPool:
            def borrow(self) -> Any:
                raise TimeoutError("pool exhausted")

        class FakeRequest:
            app = type("App", (), {"state": type("S", (), {"pool": TimingOutPool()})()})()

        rule = load_library().by_id("shared_target_pair")
        assert rule is not None

        with pytest.raises(HTTPException) as raised:
            _run_rule(FakeRequest(), rule, [], limit=10)  # type: ignore[arg-type]

        assert _detail(raised.value)["kind"] == KIND_TIMEOUT

    def test_the_timeout_message_tells_the_caller_what_to_change(self) -> None:
        """A refusal that does not say what to narrow is not actionable."""
        from semantica_service.routes.reason import _run_rule

        class TimingOutPool:
            def borrow(self) -> Any:
                raise TimeoutError("pool exhausted")

        class FakeRequest:
            app = type("App", (), {"state": type("S", (), {"pool": TimingOutPool()})()})()

        rule = load_library().by_id("shared_target_pair")
        assert rule is not None

        with pytest.raises(HTTPException) as raised:
            _run_rule(FakeRequest(), rule, [], limit=10)  # type: ignore[arg-type]

        message = str(_detail(raised.value)["message"])
        assert "scope" in message.lower()


def test_the_timeout_kind_is_distinct_from_the_fact_limit() -> None:
    """A caller retrying on "too big" must not also retry on "too slow"."""
    assert KIND_TIMEOUT != KIND_FACT_LIMIT
    assert KIND_INPUT_TOO_LARGE != KIND_FACT_LIMIT

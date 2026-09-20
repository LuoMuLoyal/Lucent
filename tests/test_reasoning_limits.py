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
from semantica.reasoning.datalog_reasoner import DatalogReasoner

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
    """Minimal stand-in for the request model's declared sizes."""

    def __init__(self, facts: int, rules: int) -> None:
        self.facts: list[Any] = [None] * facts
        self.rules: list[Any] = [None] * rules


def test_a_request_declaring_more_than_the_ceiling_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Refusing up front is what keeps the check cheap.

    The alternative is to accept the body, build the engine, and only then
    notice — by which point the memory has already been committed.
    """
    from semantica_service.config import get_settings

    monkeypatch.setattr(get_settings(), "max_reasoning_facts", 3)

    with pytest.raises(HTTPException) as caught:
        check_declared_sizes(DeclaredBody(facts=4, rules=0))

    assert _detail(caught.value)["kind"] == KIND_INPUT_TOO_LARGE


class TestDeadline:
    """The fixpoint runs under a wall-clock ceiling.

    Semi-naive evaluation spins inside one call and never yields, so without a
    deadline a pathological rule/data pair holds a threadpool worker until the
    process runs out of them — one slow request becomes an outage.
    """

    def test_a_fast_derivation_returns_its_facts(self) -> None:
        from semantica_service.routes.reason import _derive_with_deadline

        engine = DatalogReasoner()
        engine.add_fact("parent(tom, bob)")
        engine.add_rule("ancestor(X, Y) :- parent(X, Y).")

        derived = _derive_with_deadline(engine, timeout_s=10)

        assert derived is not None
        assert "ancestor(tom, bob)" in derived

    def test_a_derivation_that_outruns_the_deadline_returns_none(self) -> None:
        """None is the refusal signal; the caller turns it into a structured error."""
        from semantica_service.routes.reason import _derive_with_deadline

        class SlowEngine:
            def derive_all(self) -> list[str]:
                import time

                time.sleep(5)
                return ["late(x)"]

        slow: Any = SlowEngine()
        assert _derive_with_deadline(slow, timeout_s=1) is None

    def test_an_engine_failure_propagates_rather_than_reading_as_a_timeout(self) -> None:
        """A crash and a deadline are different answers and must not be merged."""
        from semantica_service.routes.reason import _derive_with_deadline

        class BrokenEngine:
            def derive_all(self) -> list[str]:
                raise RuntimeError("boom")

        broken: Any = BrokenEngine()
        with pytest.raises(RuntimeError, match="boom"):
            _derive_with_deadline(broken, timeout_s=10)


def test_the_timeout_kind_is_distinct_from_the_fact_limit() -> None:
    """A caller retrying on "too big" must not also retry on "too slow"."""
    assert KIND_TIMEOUT != KIND_FACT_LIMIT
    assert KIND_INPUT_TOO_LARGE != KIND_FACT_LIMIT

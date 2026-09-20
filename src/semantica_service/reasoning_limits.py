"""Resource ceilings for reasoning.

The Datalog fixpoint and SHACL validation are CPU-bound and synchronous, and
they run inside a thread pool with a finite number of workers. An unbounded
input therefore does not merely make one request slow — it removes workers from
every other request until the pool is exhausted, which turns a heavy query into
an outage.

``max_reasoning_facts`` and ``reasoning_timeout_s`` were defined in the settings
but had **no call site**: an operator could set them and observe nothing. This
module is what makes them real, and it reports an exceeded ceiling as a
structured error rather than by hanging.
"""

from __future__ import annotations

from typing import Any, NoReturn

from fastapi import HTTPException

from .config import get_settings

#: Machine-readable reasons carried in the problem detail. A caller retrying a
#: request needs to tell "too big" apart from "too slow" from "malformed", and
#: the plan requires the failure be structured rather than a timeout.
KIND_FACT_LIMIT = "fact_limit_exceeded"
KIND_TIMEOUT = "reasoning_timeout"
KIND_INPUT_TOO_LARGE = "input_too_large"


def reject(kind: str, status_code: int, detail: str, **extra: Any) -> NoReturn:
    """Raise a refusal that names its reason in a machine-readable way.

    The ``kind`` rides in the detail object so a caller can branch on it; the
    message stays human-readable for logs and for a model reading the error.
    """
    raise HTTPException(
        status_code=status_code,
        detail={"kind": kind, "message": detail, **extra},
    )


class FactBudget:
    """Tracks how many facts a reasoning run has admitted.

    A ceiling on the fact base is the cheapest guard against a rule that
    explodes combinatorially: ``INHIBITS`` joined with ``SUBSTRATE_OF`` over a
    few hundred drugs produces far more pairs than either relation holds, and
    the fixpoint keeps every one of them in memory.
    """

    def __init__(self, maximum: int) -> None:
        self.maximum = maximum

    def check(self, count: int, *, source: str) -> None:
        """Refuse when ``count`` facts exceed the ceiling.

        Checked after each phase rather than only at the end: a runaway
        derivation should be stopped while it is still cheap, not once the
        process has already allocated the whole result.
        """
        if count > self.maximum:
            reject(
                KIND_FACT_LIMIT,
                422,
                (
                    f"Reasoning produced {count} facts from {source}, over the "
                    f"configured ceiling of {self.maximum} (MAX_REASONING_FACTS). "
                    "Narrow the scope or raise the ceiling."
                ),
                fact_count=count,
                max_facts=self.maximum,
                stage=source,
            )


def check_declared_sizes(body: Any) -> None:
    """Refuse an oversized request body before any work happens.

    Pydantic's ``max_length`` already bounds these lists at the transport
    layer; this is the check that carries a ``kind``, so a caller gets a
    structured reason rather than a validation-error blob it cannot branch on.
    """
    settings = get_settings()
    declared = len(body.facts) + len(body.rules)
    if declared > settings.max_reasoning_facts:
        reject(
            KIND_INPUT_TOO_LARGE,
            422,
            (
                f"Request declares {declared} facts and rules, over the configured "
                f"ceiling of {settings.max_reasoning_facts} (MAX_REASONING_FACTS)."
            ),
            declared=declared,
            max_facts=settings.max_reasoning_facts,
        )

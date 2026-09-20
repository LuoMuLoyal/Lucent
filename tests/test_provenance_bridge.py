"""Premise recovery: the chain from a conclusion back to the data.

A derived fact on its own is not reportable. ``potential_ddi(db00091, db00208)``
is two identifiers; what makes it a finding rather than an assertion is that it
can be traced to the DrugBank rows it rests on. These tests pin that chain, and
they exist because the first two implementations of it silently returned nothing
— once because unbound variables made every atom unresolvable, once because a
cap discarded the whole result instead of a prefix.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from semantica.reasoning.datalog_reasoner import DatalogReasoner

from semantica_service.reasoning import load_library
from semantica_service.reasoning.provenance_bridge import (
    MAX_RECOVERED,
    _ground,
    premises_for_conclusion,
    recovery_is_complete,
)

RULES = {
    "rules": [
        {
            "id": "interaction",
            "intent": "interaction",
            "summary": "Inhibitor plus substrate of one enzyme.",
            "body": "potential_ddi(A, B) :- inhibits(A, E), substrate_of(B, E), A != B.",
            "consumes": ["INHIBITS", "SUBSTRATE_OF"],
        }
    ]
}


@pytest.fixture
def rule(tmp_path: Path) -> Any:
    (tmp_path / "rules.yaml").write_text(yaml.safe_dump(RULES), encoding="utf-8")
    loaded = load_library(tmp_path).by_intent("interaction")
    assert loaded is not None
    return loaded


def _engine(rule: Any, facts: list[str]) -> DatalogReasoner:
    engine = DatalogReasoner()
    for fact in facts:
        engine.add_fact(fact)
    engine.add_rule(rule.body)
    engine.derive_all()
    return engine


class TestGrounding:
    """Substituting only the bound head variables is what makes an atom a lookup."""

    def test_bound_head_arguments_are_substituted(self) -> None:
        atom = "inhibits(A, E)"

        assert _ground(atom, {"A": "db00091", "B": "db00208"}) == "inhibits(db00091, E)"

    def test_unbound_variables_stay_variables(self) -> None:
        """They are what the query is being asked to find.

        Treating an unbound variable as unresolvable made every body atom
        unresolvable, and the citation list came back empty for every
        conclusion — a conclusion shown with no evidence at all.
        """
        atom = "substrate_of(B, E)"

        assert _ground(atom, {"A": "db00091"}) == "substrate_of(B, E)"

    def test_constants_in_the_atom_are_preserved(self) -> None:
        assert _ground("inhibits(A, p08684)", {"A": "db1"}) == "inhibits(db1, p08684)"


class TestRecovery:
    def test_premises_are_recovered_for_a_conclusion(self, rule: Any) -> None:
        engine = _engine(
            rule,
            ["inhibits(db1, e1)", "substrate_of(db2, e1)", "inhibits(db3, e2)"],
        )

        recovered = premises_for_conclusion(engine, rule, engine.derive_all())

        assert recovered["potential_ddi(db1, db2)"] == [
            "inhibits(db1, e1)",
            "substrate_of(db2, e1)",
        ]

    def test_the_shared_variable_must_actually_match(self, rule: Any) -> None:
        """Two drugs on *different* enzymes is not a conclusion at all."""
        engine = _engine(rule, ["inhibits(db1, e1)", "substrate_of(db2, e9)"])

        recovered = premises_for_conclusion(engine, rule, engine.derive_all())

        assert recovered == {}

    def test_recovery_is_ordered_so_the_subset_is_stable(self, rule: Any) -> None:
        """Recovering a capped prefix must not depend on database order."""
        facts = [f"inhibits(db{i:03d}, e1)" for i in range(5)]
        facts += [f"substrate_of(db{i:03d}, e1)" for i in range(5)]
        engine = _engine(rule, facts)

        first = list(premises_for_conclusion(engine, rule, engine.derive_all(), limit=3))
        second = list(premises_for_conclusion(engine, rule, engine.derive_all(), limit=3))

        assert first == second == sorted(first)

    def test_the_cap_returns_a_prefix_rather_than_nothing(self, rule: Any) -> None:
        """The first implementation returned ``{}`` wholesale when over the cap.

        That silently stripped the evidence from every conclusion in a large
        result — the opposite of the intent, and invisible in the response.
        """
        facts = [f"inhibits(db{i:03d}, e1)" for i in range(MAX_RECOVERED + 10)]
        facts += [f"substrate_of(db{i:03d}, e1)" for i in range(MAX_RECOVERED + 10)]
        engine = _engine(rule, facts)
        derived = engine.derive_all()

        recovered = premises_for_conclusion(engine, rule, derived)

        assert len(recovered) == MAX_RECOVERED

    def test_recovery_completeness_is_reported(self, rule: Any) -> None:
        """A caller must be able to tell "no premises" from "not looked up"."""
        facts = ["inhibits(db1, e1)", "substrate_of(db2, e1)"]
        engine = _engine(rule, facts)
        derived = engine.derive_all()

        assert recovery_is_complete(rule, derived, MAX_RECOVERED) is True
        assert recovery_is_complete(rule, derived, 0) is False

    def test_only_the_rules_own_head_is_recovered(self, rule: Any) -> None:
        """derive_all returns the whole fact base, premises included.

        Recovering for every fact would present the premises as conclusions.
        """
        engine = _engine(rule, ["inhibits(db1, e1)", "substrate_of(db2, e1)"])

        recovered = premises_for_conclusion(engine, rule, engine.derive_all())

        assert all(fact.startswith("potential_ddi(") for fact in recovered)

    def test_a_conclusion_with_no_recoverable_premises_is_absent(self, rule: Any) -> None:
        """Absent means "nothing found", which the caller reports as no citations."""
        engine = _engine(rule, ["inhibits(db1, e1)", "substrate_of(db2, e1)"])
        derived = engine.derive_all()

        recovered = premises_for_conclusion(engine, rule, derived)

        assert "potential_ddi(db9, db8)" not in recovered


class TestNarrowingBeforeTheCap:
    """The cap applies to what was asked about, not to the whole fact base.

    This ordering is a correctness property, not a tuning knob, and getting it
    wrong is invisible in the response shape. Measured on a one-drug scope:
    20,116 conclusions with a cap of 500, where the query asked about 67 — every
    one of those 67 came back with no citations while 500 unrelated pairs got
    them. The response looked complete; the answers had no evidence.
    """

    def _wide_engine(self, rule: Any) -> DatalogReasoner:
        """Enough conclusions that an un-narrowed cap cannot reach the target.

        The target is added under an id that sorts *after* every generated one,
        so a prefix of the sorted conclusions cannot contain it.
        """
        facts = [f"inhibits(db{i:04d}, e1)" for i in range(MAX_RECOVERED + 50)]
        facts += [f"substrate_of(db{i:04d}, e1)" for i in range(MAX_RECOVERED + 50)]
        # `zzz` sorts last, so `potential_ddi(zzz, ...)` falls outside any prefix
        # short enough to be capped.
        facts += ["inhibits(zzz, e9)", "substrate_of(zzz2, e9)"]
        return _engine(rule, facts)

    def test_a_narrowed_conclusion_is_recovered_even_past_the_cap(self, rule: Any) -> None:
        """The target sorts last, so an un-narrowed prefix never reaches it."""
        engine = self._wide_engine(rule)
        derived = engine.derive_all()
        target = ("zzz", "zzz2")

        un_narrowed = premises_for_conclusion(engine, rule, derived)
        narrowed = premises_for_conclusion(engine, rule, derived, only={target})

        assert "potential_ddi(zzz, zzz2)" not in un_narrowed, (
            "the premise of this test no longer holds: the target fell inside the cap"
        )
        assert "potential_ddi(zzz, zzz2)" in narrowed

    def test_narrowing_excludes_what_was_not_asked_about(self, rule: Any) -> None:
        engine = self._wide_engine(rule)

        narrowed = premises_for_conclusion(
            engine, rule, engine.derive_all(), only={("db0001", "db0002")}
        )

        assert set(narrowed) == {"potential_ddi(db0001, db0002)"}

    def test_completeness_is_measured_against_the_narrowed_set(self, rule: Any) -> None:
        """A caller asking about 3 pairs must not be told its answer was cut.

        Completeness reported against the whole fact base would mark every
        narrowed response incomplete, and a caller told its input was truncated
        will discount a conclusion that was in fact fully attributed.
        """
        engine = self._wide_engine(rule)
        derived = engine.derive_all()
        selected = {("zzz", "zzz2"), ("zzz2", "zzz")}

        assert recovery_is_complete(rule, derived, MAX_RECOVERED) is False
        assert recovery_is_complete(rule, derived, MAX_RECOVERED, selected) is True

    def test_no_narrowing_still_covers_the_whole_fact_base(self, rule: Any) -> None:
        """`only=None` means "everything", which is what an unqueried request wants."""
        facts = ["inhibits(db1, e1)", "substrate_of(db2, e1)"]
        engine = _engine(rule, facts)
        derived = engine.derive_all()

        assert recovery_is_complete(rule, derived, MAX_RECOVERED, None) is True
        assert set(premises_for_conclusion(engine, rule, derived, only=None)) == {
            "potential_ddi(db1, db2)"
        }

    def test_a_non_binary_conclusion_is_not_selected(self, rule: Any) -> None:
        """A unary fact has no pair, so it cannot match a pair-keyed selection."""
        engine = _engine(rule, ["inhibits(db1, e1)", "substrate_of(db2, e1)"])
        derived = [*engine.derive_all(), "unary(thing)"]

        narrowed = premises_for_conclusion(engine, rule, derived, only={("thing", "other")})

        assert narrowed == {}


class TestFactKeyAgreement:
    """Recovered premises must be keyed the way the graph's assertion map is.

    The two are joined by string in the route: a premise whose text differs from
    the assertion key resolves to no provenance id, and the conclusion comes
    back uncited for a purely cosmetic reason.
    """

    def test_premises_match_the_assertion_key_shape(self, rule: Any) -> None:
        engine = _engine(rule, ["inhibits(db00091, p08684)", "substrate_of(db00208, p08684)"])

        recovered = premises_for_conclusion(engine, rule, engine.derive_all())
        premises = recovered["potential_ddi(db00091, db00208)"]

        # The graph keys edge facts as `type(source, target)`, lower-cased.
        assert "inhibits(db00091, p08684)" in premises
        assert "substrate_of(db00208, p08684)" in premises
        for premise in premises:
            assert premise == premise.lower()
            assert ", " in premise

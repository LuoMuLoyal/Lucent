"""The versioned rule library.

Two failure modes motivate these tests, and both are silent in production: a
rule consuming a relationship type the graph does not have never fires, and a
rule whose text does not parse never fires either. In both cases the service
answers "nothing follows", which a caller cannot tell apart from a real
negative finding. So the library refuses to load.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from semantica_service.reasoning import (
    DEFAULT_RULES_DIR,
    RuleLibraryError,
    load_library,
    verify_against_vocabulary,
)


def _write(tmp_path: Path, name: str, document: Any) -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(document), encoding="utf-8")
    return path


def _rule(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": "test_rule",
        "intent": "test",
        "summary": "A rule.",
        "body": "derived(A, B) :- inhibits(A, E), substrate_of(B, E), A != B.",
        "consumes": ["INHIBITS", "SUBSTRATE_OF"],
    }
    entry.update(overrides)
    return entry


class TestShippedLibrary:
    """The rules that ship with the service have to be loadable and coherent."""

    def test_the_shipped_library_loads(self) -> None:
        library = load_library(DEFAULT_RULES_DIR)

        assert library.rules
        for rule in library.rules.values():
            assert rule.summary, f"{rule.id} has no summary for a caller to report"
            assert rule.consumes, f"{rule.id} declares nothing it consumes"

    def test_every_shipped_rule_derives_a_binary_predicate(self) -> None:
        """Conclusions name a subject and an object, so the head must have two args.

        A unary or n-ary head could not be reported as a conclusion without
        inventing the missing parts.
        """
        library = load_library(DEFAULT_RULES_DIR)

        for rule in library.rules.values():
            assert len(rule.head_variables) == 2, f"{rule.id} head is not binary"
            assert rule.body_atoms, f"{rule.id} has no body atoms"

    def test_shipped_rules_can_be_found_by_intent(self) -> None:
        library = load_library(DEFAULT_RULES_DIR)

        assert library.by_intent("interaction") is not None
        assert library.by_intent("no_such_intent") is None

    def test_the_shipped_library_matches_the_real_vocabulary(self) -> None:
        """Every consumed type must exist in the deployed graph.

        The check runs at startup; running it here means a rule referencing a
        renamed relationship fails in CI rather than at deploy time.
        """
        library = load_library(DEFAULT_RULES_DIR)
        # The relationship types the AGE graph actually carries, as reported by
        # /schema against the live database.
        deployed = {
            "TARGETS",
            "INTERACTS_WITH",
            "INHIBITS",
            "SUBSTRATE_OF",
            "IN_ATC_CLASS",
            "SUBCLASS_OF",
            "AGONIZES",
            "ANTAGONIZES",
            "BINDS",
            "BLOCKS",
            "CARRIED_BY",
            "DOWNREGULATES",
            "INDUCES",
            "MODULATES",
            "POTENTIATES",
            "REGULATES",
            "TRANSPORTED_BY",
            "ACTIVATES",
            "ACTS_ON",
            "INACTIVATES",
            "UPREGULATES",
            "ENZYME_LINKED_TO",
        }

        verify_against_vocabulary(library, deployed)


class TestLoading:
    def test_a_rule_consuming_an_absent_type_is_refused(self, tmp_path: Path) -> None:
        """This is the silent-failure case the check exists for."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule(consumes=["INHIBIT"])]})
        library = load_library(tmp_path)

        with pytest.raises(RuleLibraryError, match="INHIBIT"):
            verify_against_vocabulary(library, {"INHIBITS", "SUBSTRATE_OF"})

    def test_an_empty_vocabulary_is_not_treated_as_a_broken_library(self) -> None:
        """An unreadable graph must not become a permanent startup failure.

        A transient connection problem would otherwise refuse every rule and
        stop the service from booting at all; /health is what reports an
        unreadable graph.
        """
        library = load_library(DEFAULT_RULES_DIR)

        verify_against_vocabulary(library, set())

    def test_the_match_is_case_insensitive(self, tmp_path: Path) -> None:
        """AGE reports types verbatim; the comparison must not depend on that."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule(consumes=["inhibits"])]})
        library = load_library(tmp_path)

        verify_against_vocabulary(library, {"INHIBITS", "SUBSTRATE_OF"})

    def test_a_rule_with_no_body_is_refused(self, tmp_path: Path) -> None:
        _write(tmp_path, "rules.yaml", {"rules": [_rule(body="derived(A, B)")]})

        with pytest.raises(RuleLibraryError, match="no ':-' body"):
            load_library(tmp_path)

    def test_a_rule_declaring_nothing_it_consumes_is_refused(self, tmp_path: Path) -> None:
        """Without the declaration the vocabulary check has nothing to check."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule(consumes=[])]})

        with pytest.raises(RuleLibraryError, match="consumes"):
            load_library(tmp_path)

    def test_a_missing_trailing_dot_is_repaired_rather_than_refused(self, tmp_path: Path) -> None:
        """The engine tolerates it, so refusing would reject a valid rule."""
        _write(
            tmp_path,
            "rules.yaml",
            {"rules": [_rule(body="derived(A, B) :- inhibits(A, B)")]},
        )
        library = load_library(tmp_path)

        assert library.by_id("test_rule") is not None
        assert library.by_id("test_rule").body.endswith(".")  # type: ignore[union-attr]

    def test_an_invalid_rule_id_is_refused(self, tmp_path: Path) -> None:
        """Ids travel in URLs and are cited in responses, so the shape matters."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule(id="Not A Slug")]})

        with pytest.raises(RuleLibraryError, match="invalid rule id"):
            load_library(tmp_path)

    def test_a_duplicate_id_is_refused(self, tmp_path: Path) -> None:
        _write(
            tmp_path,
            "rules.yaml",
            {"rules": [_rule(), _rule(intent="other")]},
        )

        with pytest.raises(RuleLibraryError, match="duplicate rule id"):
            load_library(tmp_path)

    def test_two_rules_claiming_one_intent_are_refused(self, tmp_path: Path) -> None:
        """Otherwise the intent lookup would depend on file ordering."""
        _write(
            tmp_path,
            "rules.yaml",
            {"rules": [_rule(id="rule_a"), _rule(id="rule_b")]},
        )

        with pytest.raises(RuleLibraryError, match="intent"):
            load_library(tmp_path)

    def test_an_empty_directory_is_refused(self, tmp_path: Path) -> None:
        """A service with no rules answers every request with "nothing follows"."""
        with pytest.raises(RuleLibraryError, match="no rules found"):
            load_library(tmp_path)

    def test_a_missing_directory_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(RuleLibraryError, match="does not exist"):
            load_library(tmp_path / "nope")

    def test_malformed_yaml_names_the_file(self, tmp_path: Path) -> None:
        (tmp_path / "broken.yaml").write_text("rules: [", encoding="utf-8")

        with pytest.raises(RuleLibraryError, match="broken.yaml"):
            load_library(tmp_path)


class TestRuleIntrospection:
    """A rule's own text is the source for what it derives and consumes."""

    def test_the_head_predicate_is_read_from_the_body(self, tmp_path: Path) -> None:
        _write(tmp_path, "rules.yaml", {"rules": [_rule()]})

        assert load_library(tmp_path).by_id("test_rule").head_predicate == "derived"  # type: ignore[union-attr]

    def test_head_variables_keep_their_positions(self, tmp_path: Path) -> None:
        """Premise recovery binds them positionally, so order is the contract."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule()]})

        assert load_library(tmp_path).by_id("test_rule").head_variables == ["A", "B"]  # type: ignore[union-attr]

    def test_body_atoms_exclude_inequalities(self, tmp_path: Path) -> None:
        """There is no `A != B` assertion in the graph to cite as a premise."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule()]})
        rule = load_library(tmp_path).by_id("test_rule")

        assert rule is not None
        assert rule.body_atoms == ["inhibits(A, E)", "substrate_of(B, E)"]

    def test_body_atoms_split_on_top_level_commas_only(self, tmp_path: Path) -> None:
        """Atoms contain their own commas, so a naive split would cut them."""
        _write(tmp_path, "rules.yaml", {"rules": [_rule()]})
        rule = load_library(tmp_path).by_id("test_rule")

        assert rule is not None
        assert all(atom.count("(") == atom.count(")") for atom in rule.body_atoms)

    def test_describe_reports_what_a_caller_needs(self, tmp_path: Path) -> None:
        _write(tmp_path, "rules.yaml", {"rules": [_rule()]})
        rule = load_library(tmp_path).by_id("test_rule")

        assert rule is not None
        described = rule.describe()
        assert described["id"] == "test_rule"
        assert described["derives"] == "derived"
        assert described["consumes"] == ["INHIBITS", "SUBSTRATE_OF"]

    def test_a_library_describes_its_rules_in_a_stable_order(self) -> None:
        """A response that reshuffles between calls is needlessly hard to diff."""
        library = load_library(DEFAULT_RULES_DIR)
        first = [rule["id"] for rule in library.describe()]
        second = [rule["id"] for rule in library.describe()]

        assert first == second == sorted(first)

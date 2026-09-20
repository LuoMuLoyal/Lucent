"""The versioned rule library.

Rules live in ``rules/*.yaml`` rather than arriving in a request body. The
reason is attribution: a conclusion a user sees has to be traceable to a rule
somebody reviewed, and a rule supplied per request is text nobody did.

Two failure modes drive the loader's checks, and both are silent by nature:

* **A typo'd predicate never fires.** Datalog has no declaration of intent, so
  a rule consuming ``INHIBIT`` instead of ``INHIBITS`` simply derives nothing —
  which reads exactly like "the data contains no such relation".
* **A rule and the vocabulary drift apart.** Relation types evolve; a rule that
  references one that no longer exists stops working without a single error.

So every rule declares the relationship types it consumes, and the loader
verifies them against the live graph's vocabulary at startup. A rule that
cannot fire is refused at boot rather than discovered by a user.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

#: Where the shipped rules live, relative to the repository root. Resolved
#: from this file's own location — ``<root>/src/semantica_service/reasoning/``
#: — so it works from an installed venv as well as from a checkout.
DEFAULT_RULES_DIR = Path(__file__).resolve().parents[3] / "rules"

#: A Datalog body atom, e.g. ``inhibits(A, E)``. Matches the engine's own
#: grammar (see ``DatalogReasoner._parse_rule_string``).
_ATOM = re.compile(r"([a-zA-Z0-9_]+)\s*\(")
#: A rule id must be usable as a URL path segment.
_ID = re.compile(r"^[a-z][a-z0-9_]*$")


def _split_top_level(text: str) -> list[str]:
    """Split on commas that are not inside parentheses.

    Rule bodies are comma-separated at the top level while atoms contain their
    own commas, so a plain ``split(",")`` would cut atoms in half.
    """
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def _args_of(atom: str) -> list[str]:
    """Split the argument list out of ``predicate(A, B)``."""
    start = atom.find("(")
    end = atom.rfind(")")
    if start == -1 or end <= start:
        return []
    inner = atom[start + 1 : end]
    return [part.strip() for part in inner.split(",") if part.strip()]


class RuleLibraryError(RuntimeError):
    """The rule library is unusable, and that is a startup failure.

    Raised rather than logged: a service that starts with a broken rule library
    answers every reasoning request with a confident "nothing follows", which is
    worse than refusing to start.
    """


@dataclass(frozen=True)
class ReasoningRule:
    """One reviewed rule, with the metadata a caller needs to report it."""

    id: str
    intent: str
    summary: str
    body: str
    consumes: tuple[str, ...]
    citation_hint: str = ""
    source: str = ""

    @property
    def head_predicate(self) -> str:
        """The predicate this rule derives, read from its own head."""
        head = self.body.split(":-", 1)[0].strip()
        match = _ATOM.match(head)
        if not match:
            raise RuleLibraryError(f"rule {self.id!r} has an unparseable head: {head!r}")
        return match.group(1)

    @property
    def head_variables(self) -> list[str]:
        """The head's argument list, positionally.

        Premise recovery binds these to a conclusion's arguments, so the order
        is the contract: ``potential_ddi(A, B)`` means the first argument of a
        conclusion is what ``A`` was bound to.
        """
        return _args_of(self.body.split(":-", 1)[0])

    @property
    def body_atoms(self) -> list[str]:
        """The rule's body literals, inequalities excluded.

        Inequalities are constraints rather than facts — there is no
        ``A != B`` assertion in the graph to cite — so they are not premises.
        """
        if ":-" not in self.body:
            return []
        body = self.body.split(":-", 1)[1].strip().rstrip(".")
        return [
            literal
            for literal in _split_top_level(body)
            if literal and "!=" not in literal and "<>" not in literal
        ]

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "intent": self.intent,
            "summary": self.summary,
            "citation_hint": self.citation_hint,
            "consumes": list(self.consumes),
            "derives": self.head_predicate,
        }


@dataclass
class RuleLibrary:
    """Every loaded rule, indexed by id and by intent."""

    rules: dict[str, ReasoningRule] = field(default_factory=dict)

    def by_id(self, rule_id: str) -> ReasoningRule | None:
        return self.rules.get(rule_id)

    def by_intent(self, intent: str) -> ReasoningRule | None:
        """First rule for an intent, or ``None``.

        Intents are meant to be unique; a duplicate is refused at load time, so
        this lookup is unambiguous.
        """
        for rule in self.rules.values():
            if rule.intent == intent:
                return rule
        return None

    def intents(self) -> list[str]:
        """Every intent this library answers, sorted.

        Named separately from :meth:`describe` because these are what a caller
        puts in a request: an error that listed rule *ids* would name values the
        caller never had a way to supply.
        """
        return sorted({rule.intent for rule in self.rules.values()})

    def describe(self) -> list[dict[str, Any]]:
        return [rule.describe() for rule in sorted(self.rules.values(), key=lambda r: r.id)]


def load_library(directory: Path | None = None) -> RuleLibrary:
    """Read and validate every ``*.yaml`` rule file in ``directory``.

    Validation here is *structural*: ids, uniqueness, grammar shape, and that
    each rule declares what it consumes. Checking ``consumes`` against the live
    vocabulary needs a database and happens in :func:`verify_against_vocabulary`.
    """
    root = directory or DEFAULT_RULES_DIR
    if not root.is_dir():
        raise RuleLibraryError(f"rule directory does not exist: {root}")

    library = RuleLibrary()
    intents: dict[str, str] = {}

    for path in sorted(root.glob("*.yaml")):
        try:
            document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise RuleLibraryError(f"{path.name} is not valid YAML: {exc}") from exc

        entries = document.get("rules")
        if not isinstance(entries, list) or not entries:
            raise RuleLibraryError(f"{path.name} declares no rules")

        for entry in entries:
            rule = _parse_rule(entry, source=path.name)
            if rule.id in library.rules:
                raise RuleLibraryError(f"duplicate rule id {rule.id!r} in {path.name}")
            if rule.intent in intents:
                # Two rules for one intent would make the lookup depend on file
                # ordering, so the ambiguity is refused rather than resolved.
                raise RuleLibraryError(
                    f"intent {rule.intent!r} is claimed by both "
                    f"{intents[rule.intent]!r} and {rule.id!r}"
                )
            intents[rule.intent] = rule.id
            library.rules[rule.id] = rule

    if not library.rules:
        raise RuleLibraryError(f"no rules found under {root}")
    return library


def _parse_rule(entry: Any, *, source: str) -> ReasoningRule:
    """Build one rule, refusing anything the engine could not run."""
    if not isinstance(entry, dict):
        raise RuleLibraryError(f"{source}: each rule must be a mapping")

    rule_id = str(entry.get("id") or "")
    if not _ID.match(rule_id):
        raise RuleLibraryError(f"{source}: invalid rule id {rule_id!r}")

    body = str(entry.get("body") or "").strip()
    if ":-" not in body:
        raise RuleLibraryError(f"{source}: rule {rule_id!r} has no ':-' body")
    if not body.rstrip().endswith("."):
        # The engine's parser strips a trailing dot but requires the head to be
        # call-shaped; a missing dot is a review slip worth catching here.
        body = f"{body}."

    consumes = entry.get("consumes")
    if not isinstance(consumes, list) or not consumes:
        # Without this declaration the vocabulary check has nothing to check,
        # and a renamed relation type would disable the rule silently.
        raise RuleLibraryError(f"{source}: rule {rule_id!r} declares no 'consumes' types")

    return ReasoningRule(
        id=rule_id,
        intent=str(entry.get("intent") or rule_id),
        summary=str(entry.get("summary") or "").strip(),
        body=body,
        consumes=tuple(str(name) for name in consumes),
        citation_hint=str(entry.get("citation_hint") or "").strip(),
        source=source,
    )


def verify_against_vocabulary(library: RuleLibrary, relationship_types: set[str]) -> None:
    """Refuse any rule consuming a relationship type the graph does not have.

    A rule that cannot fire is the most expensive kind of wrong: it produces an
    empty result that reads like a negative finding. Catching it at boot turns a
    silent wrong answer into a failed start.

    An empty vocabulary is treated as "the graph could not be read" rather than
    "the graph has no relationships": refusing every rule because a connection
    was momentarily unavailable would turn a transient dependency into a
    permanent startup failure. ``/health`` is what reports an unreadable graph.
    """
    if not relationship_types:
        return

    known = {name.upper() for name in relationship_types}
    for rule in library.rules.values():
        missing = [name for name in rule.consumes if name.upper() not in known]
        if missing:
            raise RuleLibraryError(
                f"rule {rule.id!r} consumes {missing}, which the graph does not "
                f"have. Known types: {sorted(known)}"
            )

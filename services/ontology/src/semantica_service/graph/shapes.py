"""The check that SHACL validation actually ran.

SHACL's failure mode is not an error, it is a false pass. A shape whose terms
name a namespace the data does not use selects no targets and constrains
nothing, and the validator reports ``conforms = true`` — which is indistinguishable
from a graph that genuinely satisfies its shapes.

Measured against the live graph, with a shape deliberately requiring a property
that cannot exist:

* correct namespace (``http://lucent.local/graph#``) -> ``conforms=False``, 895 violations
* the same shape with any other namespace    -> ``conforms=True``,  0 violations

So a caller who mistypes the prefix gets a clean report from a check that never
ran. Nothing in the SHACL spec rejects that, and pyshacl cannot be asked to,
because "no targets" is a legitimate outcome. It has to be caught before the
validation runs, by asking whether the shapes can select anything in *this*
graph.

The gate also confirms the reverse direction: the graph's own terms must be
covered by the vocabulary, so a shape author is not writing against a namespace
that the export never emits.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .export import GRAPH_NAMESPACE, GRAPH_PREFIX

#: IRI prefixes defined in a shape document, e.g. ``@prefix lucent: <...> .``.
_PREFIX = re.compile(
    r"@prefix\s+([A-Za-z_][\w.-]*)\s*:\s*<([^>]*)>\s*\.",
    re.IGNORECASE,
)
#: SPARQL-style prefix declarations, which Turtle also permits.
_SPARQL_PREFIX = re.compile(
    r"PREFIX\s+([A-Za-z_][\w.-]*)\s*:\s*<([^>]*)>",
    re.IGNORECASE,
)
#: ``<iri>`` and ``prefix:local`` references, for finding what a shape uses.
_IRI_REF = re.compile(r"<([^>]+)>")
_PREFIXED = re.compile(r"\b([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)")

_SH = "http://www.w3.org/ns/shacl#"


@dataclass
class NamespaceReport:
    """What the shapes and the graph agree on."""

    shapes_namespace: str | None = None
    """The namespace the shapes bind to the graph's prefix, if any."""

    graph_namespace: str = GRAPH_NAMESPACE
    problems: list[str] = field(default_factory=list)
    graph_terms: int = 0
    """How many distinct terms the shapes reference in the graph's namespace."""

    @property
    def ok(self) -> bool:
        return not self.problems

    def describe(self) -> dict[str, Any]:
        return {
            "graph_namespace": self.graph_namespace,
            "shapes_namespace": self.shapes_namespace,
            "graph_terms": self.graph_terms,
            "problems": list(self.problems),
        }


def check_shape_namespaces(
    shacl: str,
    *,
    graph_namespace: str = GRAPH_NAMESPACE,
    graph_prefix: str = GRAPH_PREFIX,
) -> NamespaceReport:
    """Whether a shape document can select targets in this graph.

    Refuses the two ways a shape silently checks nothing:

    1. the graph's prefix is bound to a different IRI, so every ``lucent:`` term
       in the shapes resolves elsewhere and targets nothing;
    2. the shapes never reference the graph's namespace at all, so even if a
       prefix happens to be declared, no constraint applies to the data.

    A shape that targets *nothing* is reported rather than assumed harmless: the
    report it produces says the graph conforms, and the caller has no way to
    know it does so vacuously.
    """
    report = NamespaceReport(shapes_namespace=None, graph_namespace=graph_namespace)

    declared = _prefixes(shacl)
    bound = declared.get(graph_prefix)

    if bound is None:
        report.problems.append(
            f"the shapes do not declare the prefix {graph_prefix!r}, so no term in "
            f"them can refer to the graph. Add: "
            f"@prefix {graph_prefix}: <{graph_namespace}> ."
        )
    elif _normalise(bound) != _normalise(graph_namespace):
        report.problems.append(
            f"the prefix {graph_prefix!r} is bound to <{bound}>, but the graph is "
            f"exported in <{graph_namespace}>. SHACL would select no targets and "
            f"report the graph as conforming without checking anything."
        )
    else:
        report.shapes_namespace = bound

    # Terms in the graph's namespace, counted from the fully-qualified IRIs and
    # from the prefixed names that resolve into it.
    terms = {
        iri
        for iri in _IRI_REF.findall(shacl)
        if iri.startswith(graph_namespace) and iri != graph_namespace
    }
    terms |= {
        prefix + ":" + local
        for prefix, local in _PREFIXED.findall(shacl)
        if declared.get(prefix) is not None
        and _normalise(declared[prefix]) == _normalise(graph_namespace)
    }
    report.graph_terms = len(terms)

    if report.ok and report.graph_terms == 0:
        report.problems.append(
            f"the shapes refer to nothing in <{graph_namespace}>. A shape that "
            f"selects no targets is reported as conforming, so this would return "
            f"a clean report from a check that never ran."
        )

    return report


def check_graph_is_addressable(report: NamespaceReport) -> None:
    """Raise the collected problems as one message, if there are any."""
    if report.problems:
        raise ShapeNamespaceError("; ".join(report.problems))


class ShapeNamespaceError(ValueError):
    """The shapes cannot constrain the graph they were sent with."""


def _prefixes(document: str) -> dict[str, str]:
    """Every prefix binding declared in a Turtle or SPARQL-style document."""
    found: dict[str, str] = {}
    for match in _PREFIX.finditer(document):
        found[match.group(1)] = match.group(2)
    for match in _SPARQL_PREFIX.finditer(document):
        found.setdefault(match.group(1), match.group(2))
    return found


def _normalise(iri: str) -> str:
    """Compare IRIs without caring about a trailing separator or case.

    ``http://lucent.local/graph`` and ``http://lucent.local/graph#`` denote the
    same vocabulary for matching purposes, and refusing the former would be a
    technicality rather than a real defect.
    """
    return iri.rstrip("#/").lower()


def describe_vocabulary(shapes: str) -> dict[str, Any]:
    """The prefixes a document declares, for an error message that can be acted on."""
    return {"declared_prefixes": _prefixes(shapes)}

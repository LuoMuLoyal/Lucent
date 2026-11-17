"""The shape namespace gate.

SHACL's dangerous failure is a false pass: a shape whose terms do not resolve
into the data selects no targets, constrains nothing, and reports ``conforms``.
Measured on the live graph, one shape requiring an impossible property gives
895 violations in the correct namespace and 0 in any other — so the difference
between "passed" and "never ran" is a prefix string, and nothing in the
validator can tell them apart. These tests pin the gate that does.
"""

from __future__ import annotations

from semantica_service.graph import GRAPH_NAMESPACE
from semantica_service.graph.shapes import check_shape_namespaces

GOOD = f"""
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix lucent: <{GRAPH_NAMESPACE}> .

lucent:DrugShape a sh:NodeShape ;
    sh:targetClass lucent:Drug ;
    sh:property [ sh:path lucent:name ; sh:minCount 1 ] .
"""


class TestAcceptedShapes:
    def test_a_correctly_prefixed_shape_passes(self) -> None:
        report = check_shape_namespaces(GOOD)

        assert report.ok, report.problems
        assert report.shapes_namespace == GRAPH_NAMESPACE
        assert report.graph_terms > 0

    def test_a_trailing_separator_difference_is_accepted(self) -> None:
        """`graph` and `graph#` name the same vocabulary; refusing is a technicality."""
        without_hash = GOOD.replace(GRAPH_NAMESPACE, GRAPH_NAMESPACE.rstrip("#"))

        assert check_shape_namespaces(without_hash).ok

    def test_sparql_style_prefixes_are_understood(self) -> None:
        """Turtle permits PREFIX as well as @prefix, so the gate must too."""
        shapes = GOOD.replace("@prefix", "PREFIX").replace(" .\n", "\n")

        assert check_shape_namespaces(shapes).ok

    def test_fully_qualified_iris_count_as_naming_the_graph(self) -> None:
        """A shape may write the IRI out instead of using the prefix."""
        shapes = f"""
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix lucent: <{GRAPH_NAMESPACE}> .
        lucent:DrugShape a sh:NodeShape ;
            sh:targetClass <{GRAPH_NAMESPACE}Drug> .
        """

        report = check_shape_namespaces(shapes)

        assert report.ok, report.problems
        assert report.graph_terms > 0


class TestRefusedShapes:
    def test_the_wrong_namespace_is_refused(self) -> None:
        """This is the measured false pass, caught before the validator runs."""
        wrong = GOOD.replace(GRAPH_NAMESPACE, "http://example.org/other#")
        report = check_shape_namespaces(wrong)

        assert not report.ok
        assert any("bound to" in problem for problem in report.problems)

    def test_a_missing_prefix_is_refused(self) -> None:
        shapes = """
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix ex: <http://example.org/x#> .
        ex:Shape a sh:NodeShape ;
            sh:targetClass ex:Widget .
        """
        report = check_shape_namespaces(shapes)

        assert not report.ok
        assert any("do not declare the prefix" in problem for problem in report.problems)

    def test_a_declared_but_unused_prefix_is_refused(self) -> None:
        """Declaring `lucent:` without using it still constrains nothing.

        A document can carry the right prefix and still have every shape aimed
        elsewhere; the prefix being present is not evidence that any constraint
        applies to this graph.
        """
        shapes = f"""
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix lucent: <{GRAPH_NAMESPACE}> .
        @prefix ex: <http://example.org/x#> .
        ex:Shape a sh:NodeShape ;
            sh:targetClass ex:Widget ;
            sh:property [ sh:path ex:size ; sh:minCount 1 ] .
        """
        report = check_shape_namespaces(shapes)

        assert not report.ok
        assert any("refer to nothing" in problem for problem in report.problems)

    def test_an_empty_document_is_refused(self) -> None:
        report = check_shape_namespaces("")

        assert not report.ok


class TestReport:
    def test_the_report_names_both_namespaces(self) -> None:
        """The caller needs the expected IRI to fix the request."""
        wrong = GOOD.replace(GRAPH_NAMESPACE, "http://example.org/other#")
        described = check_shape_namespaces(wrong).describe()

        assert described["graph_namespace"] == GRAPH_NAMESPACE
        assert described["shapes_namespace"] is None
        assert described["problems"]

    def test_a_passing_report_has_no_problems(self) -> None:
        described = check_shape_namespaces(GOOD).describe()

        assert described["problems"] == []
        assert described["graph_terms"] > 0

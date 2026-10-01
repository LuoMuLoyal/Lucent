"""Bearer-token authentication on every route except /health.

The service was previously reachable only over a compose network and carried no
credential at all. It now publishes a host port and is called across machines,
so these tests pin the two properties that make the change real rather than
decorative: an unauthenticated caller is refused, and no route is accidentally
left open. The second is the one that rots — a router added later joins the open
side silently and nothing else in the suite would notice.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from conftest import TEST_API_TOKEN
from fastapi.testclient import TestClient

from semantica_service import main
from semantica_service.config import Settings

# Every route that is expected to require the token, with a method to exercise.
# Pinned as a list rather than derived from the app on purpose: a test that asks
# the app which routes it protects cannot fail when the app protects fewer.
PROTECTED_ROUTES = [
    ("GET", "/schema"),
    ("GET", "/rules"),
    ("POST", "/validate"),
    ("POST", "/reason"),
    ("POST", "/query"),
    ("POST", "/resolve"),
    ("POST", "/provenance"),
    ("GET", "/provenance/verify"),
]

# The one route that must stay open: the compose healthcheck and any load
# balancer probe it, and neither can carry a credential.
OPEN_ROUTES = [("GET", "/health")]


class StubStore:
    """Minimal store so the app can boot without a database."""

    def get_stats(self) -> dict[str, Any]:
        return {
            "node_count": 0,
            "relationship_count": 0,
            "label_counts": {},
            "relationship_type_counts": {
                "TARGETS": 1,
                "INHIBITS": 1,
                "SUBSTRATE_OF": 1,
                "ACTS_ON": 1,
                "IN_ATC_CLASS": 1,
            },
        }

    def execute_query(self, query: str, parameters: Any = None) -> dict[str, Any]:
        return {"success": True, "records": []}

    def close(self) -> None:
        pass


class StubPool:
    def __init__(self, store: StubStore) -> None:
        self._store = store

    @contextmanager
    def borrow(self) -> Iterator[StubStore]:
        yield self._store

    @property
    def size(self) -> int:
        return 1

    @property
    def idle_count(self) -> int:
        return 0

    def close(self) -> None:
        pass


def build(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> TestClient:
    """An *unauthenticated* client, so each test states its own credential."""
    monkeypatch.setattr(main, "StorePool", lambda _settings: StubPool(StubStore()))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return TestClient(main.create_app())


@pytest.fixture
def settings() -> Settings:
    return Settings(neo4j_database="neo4j", api_token=TEST_API_TOKEN)


# --- refusals --------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), PROTECTED_ROUTES)
def test_a_request_without_a_token_is_refused(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, method: str, path: str
) -> None:
    """Reaching the port must not be the same as being allowed to use it."""
    with build(monkeypatch, settings) as client:
        response = client.request(method, path, json={})

    assert response.status_code == 401


@pytest.mark.parametrize(("method", "path"), PROTECTED_ROUTES)
def test_a_request_with_the_wrong_token_is_refused(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, method: str, path: str
) -> None:
    with build(monkeypatch, settings) as client:
        response = client.request(
            method, path, json={}, headers={"Authorization": "Bearer not-the-token"}
        )

    assert response.status_code == 401


@pytest.mark.parametrize(("method", "path"), PROTECTED_ROUTES)
def test_a_rejected_request_says_which_scheme_to_use(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, method: str, path: str
) -> None:
    """RFC 6750: a 401 on a bearer resource must name the scheme.

    Without it a client cannot tell whether to retry with a token or give up.
    """
    with build(monkeypatch, settings) as client:
        response = client.request(method, path, json={})

    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_the_refusal_is_structured_like_every_other_error(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Lucent branches on `detail.kind`; a bare string here would be the one
    transport failure it cannot classify."""
    with build(monkeypatch, settings) as client:
        detail = client.get("/schema").json()["detail"]

    assert detail["kind"] == "unauthorized"
    assert detail["message"]


def test_a_malformed_authorization_header_is_refused(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """FastAPI's own error path would answer 403 with a plain string."""
    with build(monkeypatch, settings) as client:
        response = client.get("/schema", headers={"Authorization": "Basic xyz"})

    assert response.status_code == 401


def test_a_token_that_shares_a_prefix_is_refused(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Guards against a substring/`startswith` comparison creeping in."""
    with build(monkeypatch, settings) as client:
        response = client.get("/schema", headers={"Authorization": f"Bearer {TEST_API_TOKEN}extra"})

    assert response.status_code == 401


# --- the open surface ------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), OPEN_ROUTES)
def test_the_health_probe_stays_open(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, method: str, path: str
) -> None:
    """The compose healthcheck and any load balancer need it credential-free."""
    with build(monkeypatch, settings) as client:
        response = client.request(method, path)

    assert response.status_code == 200


# --- the accepted path -----------------------------------------------------


def test_the_configured_token_is_accepted(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    with build(monkeypatch, settings) as client:
        response = client.get("/schema", headers={"Authorization": f"Bearer {TEST_API_TOKEN}"})

    assert response.status_code == 200


def test_the_openapi_schema_advertises_the_scheme(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    """Callers should discover the credential from the schema, not from a 401."""
    with build(monkeypatch, settings) as client:
        schema = client.get("/openapi.json").json()

    assert "HTTPBearer" in schema["components"]["securitySchemes"]


def test_every_route_is_accounted_for(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """No reasoning route may sit on the open side of the surface.

    This is the structural check: it compares the routes the app actually serves
    against the two pinned lists, so a router added later without the auth
    dependency fails here rather than in production.
    """
    with build(monkeypatch, settings) as client:
        paths = client.get("/openapi.json").json()["paths"]

    documented = {
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
        # The schema endpoints are FastAPI's own introspection surface, not the
        # reasoning contract, and are excluded from both lists.
        if path not in {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
    }

    assert documented == set(PROTECTED_ROUTES) | set(OPEN_ROUTES)


# --- startup ---------------------------------------------------------------


def test_the_app_refuses_to_start_without_a_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Booting without a credential is indistinguishable from working until the
    first call, and surfaces at the caller as "reasoning unavailable"."""
    # `api_token=""` is explicit rather than omitted: conftest puts a token in the
    # environment so the suite can import the app at all, and an explicit value
    # outranks the environment. Omitting it here would silently read that token
    # and test nothing.
    monkeypatch.setattr(
        main, "get_settings", lambda: Settings(neo4j_database="neo4j", api_token="")
    )

    with pytest.raises(RuntimeError, match="API_TOKEN"):
        main.create_app()

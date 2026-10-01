"""Health endpoint behaviour.

Two states matter: the graph is reachable (200 with real counts) and it is not
(503). The second is the one that keeps a load balancer from routing traffic to
a process whose dependency is down, so it is covered explicitly.
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


class StubStore:
    """Graph store stand-in with a configurable outcome."""

    def __init__(self, stats: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self._stats = stats or {"nodes": 396, "edges": 6784}
        self._error = error

    def get_stats(self) -> dict[str, Any]:
        if self._error is not None:
            raise self._error
        return self._stats

    def close(self) -> None:
        pass


class StubPool:
    """Pool stand-in that yields a fixed store."""

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


@pytest.fixture
def settings() -> Settings:
    return Settings(neo4j_database="neo4j", api_token=TEST_API_TOKEN)


def build_client(
    monkeypatch: pytest.MonkeyPatch, store: StubStore, settings: Settings
) -> TestClient:
    """Create a client whose lifespan installs a stub pool and fixed settings."""
    monkeypatch.setattr(main, "StorePool", lambda _settings: StubPool(store))
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    return TestClient(main.create_app(), headers={"Authorization": f"Bearer {TEST_API_TOKEN}"})


def test_health_reports_graph_size(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["graph"] == "neo4j"
    assert body["stats"] == {"nodes": 396, "edges": 6784}


def test_health_is_503_when_the_graph_is_unreachable(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    store = StubStore(error=ConnectionError("could not connect to server"))
    with build_client(monkeypatch, store, settings) as client:
        response = client.get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    # The probe must name the failure, not just report "down".
    assert "ConnectionError" in body["error"]


def test_health_reports_pool_occupancy(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    with build_client(monkeypatch, StubStore(), settings) as client:
        body = client.get("/health").json()

    assert body["pool"] == {"size": 1, "idle": 0}


def test_health_uses_the_configured_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reported graph follows configuration rather than a hardcoded name."""
    custom = Settings(neo4j_database="some_other_graph", api_token=TEST_API_TOKEN)
    with build_client(monkeypatch, StubStore(), custom) as client:
        body = client.get("/health").json()

    assert body["graph"] == "some_other_graph"


def test_openapi_schema_is_served(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """The route surface stays introspectable for the Lucent client."""
    with build_client(monkeypatch, StubStore(), settings) as client:
        schema = client.get("/openapi.json").json()

    assert "/health" in schema["paths"]

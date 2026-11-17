"""Pool behaviour, exercised without a live Neo4j server.

Acquisition, release, reuse and the dead-driver path are all decided in Python,
so they can be covered with a stub store. What a stub cannot prove is that the
server honours the per-transaction timeout; that is asserted against a live
server by the integration checks under ``scripts/``.
"""

from __future__ import annotations

import threading

import pytest

from semantica_service.config import Settings
from semantica_service.graph import pool as pool_module
from semantica_service.graph.pool import StorePool


class FakeStore:
    """Stands in for semantica's ``Neo4jStore``.

    Mirrors the two attributes the pool inspects: ``_driver`` (the closed
    marker) and the connection arguments it was built with.
    """

    instances: list[FakeStore] = []
    close_calls = 0

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self._driver: object | None = object()
        FakeStore.instances.append(self)

    def connect(self) -> bool:
        return True

    def close(self) -> None:
        FakeStore.close_calls += 1
        self._driver = None


@pytest.fixture
def settings() -> Settings:
    return Settings(
        neo4j_uri="bolt://db:7687",
        neo4j_user="u",
        neo4j_password="p",
        neo4j_database="neo4j",
        pool_min_size=1,
        pool_max_size=2,
        statement_timeout_ms=15_000,
    )


@pytest.fixture(autouse=True)
def patch_store(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeStore.instances = []
    FakeStore.close_calls = 0
    monkeypatch.setattr(pool_module, "Neo4jGraphStore", FakeStore)


def test_store_is_built_with_the_configured_connection(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow() as store:
        assert isinstance(store, FakeStore)
    assert store.kwargs["uri"] == "bolt://db:7687"
    assert store.kwargs["user"] == "u"
    assert store.kwargs["password"] == "p"
    assert store.kwargs["database"] == "neo4j"
    assert store.kwargs["connection_timeout"] == settings.connect_timeout_s
    pool.close()


def test_missing_password_is_refused() -> None:
    """A blank password is a configuration error, not an anonymous login.

    Neo4j would reject it anyway, but only after a round trip; failing here
    names the actual problem.
    """
    pool = StorePool(Settings(neo4j_password=""))
    with pytest.raises(RuntimeError, match="NEO4J_PASSWORD"):
        with pool.borrow():
            pass


def test_borrow_returns_a_connected_store(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow() as store:
        assert isinstance(store, FakeStore)
    pool.close()


def test_store_is_reused_after_release(settings: Settings) -> None:
    """Sequential requests must not build a new driver each time."""
    pool = StorePool(settings)
    with pool.borrow() as first:
        pass
    with pool.borrow() as second:
        assert second is first
    assert len(FakeStore.instances) == 1
    pool.close()


def test_pool_is_bounded_by_max_size(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow():
        with pool.borrow():
            assert pool.size == 2
            # A third concurrent call has no store to take. It must fail
            # loudly rather than silently exceeding the cap.
            with pytest.raises(TimeoutError):
                with pool.borrow():
                    pass
    pool.close()


def test_store_is_returned_when_the_body_raises(settings: Settings) -> None:
    pool = StorePool(settings)
    with pytest.raises(ValueError):
        with pool.borrow():
            raise ValueError("boom")
    assert pool.idle_count == 1
    pool.close()


def test_dead_driver_is_not_handed_out(settings: Settings) -> None:
    """A store whose driver was closed is discarded, not reused."""
    pool = StorePool(settings)
    with pool.borrow() as store:
        store._driver = None  # driver closed underneath us
    with pool.borrow() as replacement:
        assert replacement is not store
    pool.close()


def test_close_releases_idle_stores(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow():
        pass
    pool.close()
    assert pool.idle_count == 0
    assert FakeStore.close_calls == 1


def test_borrow_after_close_is_rejected(settings: Settings) -> None:
    pool = StorePool(settings)
    pool.close()
    with pytest.raises(RuntimeError, match="closed"):
        with pool.borrow():
            pass


def test_failed_connect_does_not_leak_a_slot(settings: Settings) -> None:
    """A store that fails to connect must not consume the pool's budget."""
    assert settings.pool_max_size == 2  # the fixture's configured cap

    class FailingStore(FakeStore):
        def connect(self) -> bool:
            raise RuntimeError("no server")

    strict = Settings(neo4j_password="p", pool_min_size=1, pool_max_size=1)
    pool = StorePool(strict)
    # Assigning a subclass of the fake onto the module symbol is the point of the
    # test: it swaps the constructor the pool uses. Two codes fire here —
    # `attr-defined` (the module does not re-export the symbol) and `assignment`
    # (subclass narrowed onto the declared type) — and the pair is tight enough
    # that, if the underlying code ever changes, `unused-ignore` will say so.
    pool_module.Neo4jGraphStore = FailingStore  # type: ignore[attr-defined, assignment]
    try:
        for _ in range(3):
            with pytest.raises(RuntimeError, match="no server"):
                with pool.borrow():
                    pass
        assert pool.size == 0
    finally:
        pool.close()


def test_concurrent_borrows_share_the_pool(settings: Settings) -> None:
    """Threads borrow and release without exceeding the cap or deadlocking."""
    pool = StorePool(settings)
    errors: list[BaseException] = []
    peak = 0
    peak_lock = threading.Lock()

    def worker() -> None:
        nonlocal peak
        try:
            with pool.borrow():
                with peak_lock:
                    peak = max(peak, pool.size)
        except BaseException as exc:  # noqa: BLE001 - recorded for the assert
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, f"worker errors: {errors}"
    assert peak <= settings.pool_max_size
    pool.close()

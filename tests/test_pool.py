"""Pool behaviour, exercised without a live AGE server.

Acquisition, release, reuse and the dead-connection path are all decided in
Python, so they can be covered with a stub store. The one thing a stub cannot
prove is that the server honours ``statement_timeout``; see the integration
test for that.
"""

from __future__ import annotations

import threading

import pytest

from semantica_service.config import Settings
from semantica_service.graph import pool as pool_module
from semantica_service.graph.pool import StorePool, _dsn_with_timeouts, _parse_pg_duration_ms


class FakeConn:
    def __init__(self) -> None:
        self.closed = 0


class FakeStore:
    """Stands in for ApacheAgeStore."""

    instances: list[FakeStore] = []
    close_calls = 0

    def __init__(self, connection_string: str, graph_name: str) -> None:
        self.connection_string = connection_string
        self.graph_name = graph_name
        self._conn: FakeConn | None = FakeConn()
        FakeStore.instances.append(self)

    def connect(self) -> bool:
        return True

    def close(self) -> None:
        FakeStore.close_calls += 1
        self._conn = None


@pytest.fixture
def settings() -> Settings:
    return Settings(
        age_dsn="host=db port=5432 dbname=graph user=u password=p",
        graph_name="g",
        pool_min_size=1,
        pool_max_size=2,
        statement_timeout_ms=15_000,
    )


@pytest.fixture(autouse=True)
def patch_store(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeStore.instances = []
    FakeStore.close_calls = 0
    monkeypatch.setattr(pool_module, "ApacheAgeStore", FakeStore)

    # The live-session assertion needs a real cursor; the stub has none.
    def skip_timeout_assertion(_store: FakeStore, _expected_ms: int) -> None:
        return None

    monkeypatch.setattr(pool_module, "_assert_statement_timeout", skip_timeout_assertion)


def test_dsn_carries_both_timeouts(settings: Settings) -> None:
    dsn = _dsn_with_timeouts(settings)
    assert "connect_timeout=10" in dsn
    assert "options='-c statement_timeout=15000'" in dsn
    assert dsn.startswith("host=db port=5432 dbname=graph user=u password=p")


def test_dsn_is_accepted_by_libpq(settings: Settings) -> None:
    """`options` holds a space, so it must be quoted or libpq rejects the DSN.

    Without the quotes libpq reads `statement_timeout=15000` as a connection
    option of its own and fails with 'invalid connection option'.
    """
    import psycopg2.extensions

    parsed = psycopg2.extensions.parse_dsn(_dsn_with_timeouts(settings))
    assert parsed["options"] == "-c statement_timeout=15000"
    assert parsed["connect_timeout"] == "10"


def test_dsn_values_with_quotes_are_escaped() -> None:
    """A password containing a quote must not break out of the value."""
    settings = Settings(age_dsn="host=db password=it's-secret")
    parsed_dsn = _dsn_with_timeouts(settings)

    import psycopg2.extensions

    assert psycopg2.extensions.parse_dsn(parsed_dsn)["password"] == "it's-secret"


class TestParsePgDuration:
    """`SHOW statement_timeout` normalises units, so parsing must not be textual."""

    def test_seconds_are_accepted_for_a_millisecond_request(self) -> None:
        """The regression: PostgreSQL renders 15000ms as '15s'.

        Comparing the raw string against '15000ms' rejected a correctly
        configured connection and took the service down.
        """
        assert _parse_pg_duration_ms("15s") == 15_000

    def test_plain_milliseconds(self) -> None:
        assert _parse_pg_duration_ms("15000ms") == 15_000

    def test_zero_means_disabled(self) -> None:
        assert _parse_pg_duration_ms("0") == 0

    def test_minutes_are_not_confused_with_milliseconds(self) -> None:
        assert _parse_pg_duration_ms("2min") == 120_000

    def test_fractional_value(self) -> None:
        assert _parse_pg_duration_ms("1.5s") == 1_500

    def test_unrecognised_value_is_rejected(self) -> None:
        import pytest as _pytest

        with _pytest.raises(ValueError, match="Unrecognised"):
            _parse_pg_duration_ms("soon")


def test_dsn_preserves_operator_supplied_values() -> None:
    """An explicit DSN override must not be clobbered."""
    settings = Settings(
        age_dsn="host=db connect_timeout=99 options='-c statement_timeout=1000'",
        connect_timeout_s=10,
        statement_timeout_ms=15_000,
    )
    dsn = _dsn_with_timeouts(settings)
    assert dsn.count("connect_timeout") == 1
    assert "connect_timeout=99" in dsn
    assert "statement_timeout=1000" in dsn


def test_borrow_returns_a_connected_store(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow() as store:
        assert isinstance(store, FakeStore)
        assert store.graph_name == "g"
    pool.close()


def test_store_is_reused_after_release(settings: Settings) -> None:
    """Sequential requests must not open a new connection each time."""
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
            # A third concurrent call has no connection to take. It must fail
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


def test_dead_connection_is_not_handed_out(settings: Settings) -> None:
    pool = StorePool(settings)
    with pool.borrow() as store:
        store._conn.closed = 1  # server-side disconnect
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

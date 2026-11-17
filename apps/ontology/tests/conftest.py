"""Shared test configuration.

The API token lives here rather than in each module so the value the app is
configured with and the value the clients send cannot drift apart.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# Any non-empty string: the service only compares it against the request's
# bearer token. It is not a credential and grants nothing by itself.
TEST_API_TOKEN = "test-token"

# Set before any test module imports `semantica_service.main`: that module builds
# the app at import time (`app = create_app()`), and `create_app()` refuses to
# run without a token. Without this the whole suite would fail at collection for
# a reason that has nothing to do with what it tests.
#
# `setdefault` rather than an assignment: a CI job that supplies a real token
# should keep it.
os.environ.setdefault("API_TOKEN", TEST_API_TOKEN)


@pytest.fixture
def api_token() -> str:
    """The token every test app is configured with."""
    return TEST_API_TOKEN


@pytest.fixture
def auth_headers(api_token: str) -> Iterator[dict[str, str]]:
    """Default headers for an authenticated client."""
    yield {"Authorization": f"Bearer {api_token}"}

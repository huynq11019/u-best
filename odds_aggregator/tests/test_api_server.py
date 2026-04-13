import os
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import TestClient, TestServer

from api.server import create_api_app


class _FakeIngestor:
    def __init__(self, name: str, healthy: bool = True):
        self.name = name
        self._healthy = healthy
        self.reload_called = 0

    def get_health(self) -> dict:
        return {
            "name": self.name,
            "healthy": self._healthy,
            "error_count": 0,
            "last_error": None,
            "poll_interval": 1.0,
        }

    def reload_token(self) -> None:
        self.reload_called += 1


class _FakeStateCache:
    async def get_all_live_keys(self) -> list[str]:
        return ["k1", "k2"]


@pytest.mark.asyncio
async def test_health_status_ok_and_stats_live_endpoints():
    saba = _FakeIngestor("saba", healthy=True)
    xbet = _FakeIngestor("1xbet", healthy=True)
    aggregator = SimpleNamespace(
        ingestors=[saba, xbet],
        merger=SimpleNamespace(get_stats=lambda: {"total_live_matches": 2}),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {"sent": 1}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {"published": 1}),
        state_cache=_FakeStateCache(),
    )

    app = create_api_app(aggregator)
    async with TestServer(app) as server, TestClient(server) as client:
        health_resp = await client.get("/health")
        assert health_resp.status == 200
        health_payload = await health_resp.json()
        assert health_payload["status"] == "ok"
        assert len(health_payload["ingestors"]) == 2

        stats_resp = await client.get("/stats")
        assert stats_resp.status == 200
        stats_payload = await stats_resp.json()
        assert "merger" in stats_payload
        assert "n8n" in stats_payload
        assert "redis_pubsub" in stats_payload
        assert "normalizer" in stats_payload

        live_resp = await client.get("/live")
        assert live_resp.status == 200
        live_payload = await live_resp.json()
        assert live_payload == {"count": 2, "match_keys": ["k1", "k2"]}


@pytest.mark.asyncio
async def test_health_status_degraded_when_any_ingestor_unhealthy():
    aggregator = SimpleNamespace(
        ingestors=[_FakeIngestor("saba", healthy=False)],
        merger=SimpleNamespace(get_stats=lambda: {}),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {}),
        state_cache=_FakeStateCache(),
    )

    app = create_api_app(aggregator)
    async with TestServer(app) as server, TestClient(server) as client:
        health_resp = await client.get("/health")
        assert health_resp.status == 207
        payload = await health_resp.json()
        assert payload["status"] == "degraded"


@pytest.mark.asyncio
async def test_reload_token_success_and_not_found():
    saba = _FakeIngestor("saba", healthy=True)
    aggregator = SimpleNamespace(
        ingestors=[saba],
        merger=SimpleNamespace(get_stats=lambda: {}),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {}),
        state_cache=_FakeStateCache(),
    )

    app = create_api_app(aggregator)
    async with TestServer(app) as server, TestClient(server) as client:
        old_token = os.environ.get("SABA_TOKEN")
        try:
            resp = await client.post("/admin/reload-token", json={"token": "new-token"})
            assert resp.status == 200
            payload = await resp.json()
            assert payload["status"] == "ok"
            assert saba.reload_called == 1
            assert os.environ.get("SABA_TOKEN") == "new-token"
        finally:
            if old_token is None:
                os.environ.pop("SABA_TOKEN", None)
            else:
                os.environ["SABA_TOKEN"] = old_token

    aggregator_missing = SimpleNamespace(
        ingestors=[_FakeIngestor("1xbet", healthy=True)],
        merger=SimpleNamespace(get_stats=lambda: {}),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {}),
        state_cache=_FakeStateCache(),
    )
    app_missing = create_api_app(aggregator_missing)
    async with TestServer(app_missing) as server, TestClient(server) as client:
        resp = await client.post("/admin/reload-token", json={"token": "x"})
        assert resp.status == 404

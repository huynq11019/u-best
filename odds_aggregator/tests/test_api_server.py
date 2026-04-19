import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from api.server import create_api_app
from normalizer.schema import MatchStatus, MergedEvent, Score


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


def _make_event(match_key: str, home: str, away: str) -> MergedEvent:
    return MergedEvent(
        match_key=match_key,
        league="Premier League",
        home_team=home,
        away_team=away,
        status=MatchStatus.LIVE,
        score=Score(home=1, away=0),
        minute=56,
        source_markets={
            "saba": [{"market_type": "ou", "selections": [{"label": "over", "odds": 1.91, "line": 2.5}]}],
            "1xbet": [{"market_type": "ou", "selections": [{"label": "under", "odds": 2.02, "line": 2.5}]}],
        },
        source_ids={"saba": "s1", "1xbet": "x1"},
        merged_at=1713436800.0,
    )


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
        with patch.dict(os.environ, {"SABA_TOKEN": "test-token-initial"}, clear=False):
            resp = await client.post("/admin/reload-token", json={"token": "new-token"})
            assert resp.status == 200
            payload = await resp.json()
            assert payload["status"] == "ok"
            assert saba.reload_called == 1
            assert os.environ.get("SABA_TOKEN") == "new-token"

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


@pytest.mark.asyncio
async def test_events_list_returns_event_summaries_only():
    e1 = _make_event("league|arsenal|chelsea|1", "Arsenal", "Chelsea")
    e2 = _make_event("league|mu|mc|2", "Man United", "Man City")

    aggregator = SimpleNamespace(
        ingestors=[_FakeIngestor("saba", healthy=True)],
        merger=SimpleNamespace(
            get_stats=lambda: {},
            list_events=lambda: [e1, e2],
            get_event=lambda _match_key: None,
        ),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {}),
        state_cache=_FakeStateCache(),
    )

    app = create_api_app(aggregator)
    async with TestServer(app) as server, TestClient(server) as client:
        resp = await client.get("/events")
        assert resp.status == 200
        payload = await resp.json()
        assert payload["count"] == 2
        assert len(payload["events"]) == 2

        first = payload["events"][0]
        assert "match_key" in first
        assert "home_team" in first
        assert "away_team" in first
        assert "two_sources" in first
        assert "source_markets" not in first
        assert "source_ids" not in first


@pytest.mark.asyncio
async def test_event_detail_returns_odds_and_not_found():
    key = "league|arsenal|chelsea|1"
    event = _make_event(key, "Arsenal", "Chelsea")

    aggregator = SimpleNamespace(
        ingestors=[_FakeIngestor("saba", healthy=True)],
        merger=SimpleNamespace(
            get_stats=lambda: {},
            list_events=lambda: [event],
            get_event=lambda match_key: event if match_key == key else None,
        ),
        n8n_sink=SimpleNamespace(get_metrics=lambda: {}),
        redis_sink=SimpleNamespace(get_metrics=lambda: {}),
        state_cache=_FakeStateCache(),
    )

    app = create_api_app(aggregator)
    async with TestServer(app) as server, TestClient(server) as client:
        ok_resp = await client.get(f"/events/{key}")
        assert ok_resp.status == 200
        ok_payload = await ok_resp.json()
        assert ok_payload["event"]["match_key"] == key
        assert "source_markets" in ok_payload["event"]
        assert "source_ids" in ok_payload["event"]
        assert ok_payload["event"]["two_sources"] is True

        missing_key = "league|not|exist|x"
        miss_resp = await client.get(f"/events/{missing_key}")
        assert miss_resp.status == 404
        miss_payload = await miss_resp.json()
        assert miss_payload == {"error": "event not found", "match_key": missing_key}

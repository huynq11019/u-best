import time

import pytest

from normalizer.schema import MatchStatus, MergedEvent, Score
from state.cache import StateCache


class _FakeRedis:
    def __init__(self):
        self.store = {}
        self.setex_calls = []

    async def get(self, key):
        return self.store.get(key)

    async def setex(self, key, ttl, payload):
        self.store[key] = payload
        self.setex_calls.append((key, ttl, payload))

    async def keys(self, pattern):
        prefix = pattern[:-1] if pattern.endswith("*") else pattern
        return [k for k in self.store.keys() if k.startswith(prefix)]


def _make_event(match_key: str = "pl|a|b") -> MergedEvent:
    return MergedEvent(
        match_key=match_key,
        league="PL",
        home_team="A",
        away_team="B",
        status=MatchStatus.LIVE,
        score=Score(1, 0),
        minute=10,
        source_markets={"saba": [{"market_type": "ou", "selections": [{"label": "over", "odds": 1.9, "line": 2.5}]}]},
        source_ids={"saba": "1"},
        merged_at=time.time(),
    )


@pytest.mark.asyncio
async def test_state_cache_without_redis_is_safe_noop():
    cache = StateCache()
    event = _make_event()
    assert await cache.is_duplicate(event) is False
    await cache.save_snapshot(event)
    assert await cache.get_all_live_keys() == []


@pytest.mark.asyncio
async def test_state_cache_duplicate_snapshot_and_live_keys():
    cache = StateCache()
    fake_redis = _FakeRedis()
    cache._redis = fake_redis
    event = _make_event("pl|arsenal|chelsea")

    first = await cache.is_duplicate(event)
    second = await cache.is_duplicate(event)
    assert first is False
    assert second is True

    await cache.save_snapshot(event)
    keys = await cache.get_all_live_keys()
    assert keys == ["pl|arsenal|chelsea"]

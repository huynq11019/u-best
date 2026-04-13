import asyncio
import time
from unittest.mock import AsyncMock

import pytest

from normalizer.schema import MatchStatus, MergedEvent, Score
from sinks.n8n_webhook import N8NWebhookSink
from sinks.redis_pubsub import RedisPubSubSink

CHANNEL_KEY_TRUNCATE_LENGTH = 60
EXTRA_KEY_SUFFIX_LENGTH = 40
LONG_MATCH_KEY_SUFFIX_LENGTH = CHANNEL_KEY_TRUNCATE_LENGTH + EXTRA_KEY_SUFFIX_LENGTH


def _make_event(match_key: str = "pl|home|away", with_two_sources: bool = True) -> MergedEvent:
    source_markets = {"saba": [{"market_type": "ou", "selections": []}]}
    source_ids = {"saba": "s1"}
    if with_two_sources:
        source_markets["1xbet"] = [{"market_type": "ou", "selections": []}]
        source_ids["1xbet"] = "x1"
    return MergedEvent(
        match_key=match_key,
        league="PL",
        home_team="Home",
        away_team="Away",
        status=MatchStatus.LIVE,
        score=Score(0, 0),
        minute=20,
        source_markets=source_markets,
        source_ids=source_ids,
        merged_at=time.time(),
    )


class _FakeRedis:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail
        self.calls = []

    async def publish(self, channel, payload):
        if self.should_fail:
            raise RuntimeError("publish error")
        self.calls.append((channel, payload))


class _FakeResponse:
    def __init__(self, status: int):
        self.status = status


class _FakeResponseCtx:
    def __init__(self, status: int):
        self._status = status

    async def __aenter__(self):
        return _FakeResponse(self._status)

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeSession:
    def __init__(self, status: int | None = None, exc: Exception | None = None):
        self.status = status
        self.exc = exc

    def post(self, *_args, **_kwargs):
        if self.exc:
            raise self.exc
        return _FakeResponseCtx(self.status if self.status is not None else 200)


@pytest.mark.asyncio
async def test_redis_sink_publish_paths():
    sink = RedisPubSubSink()
    event = _make_event("pl|very|long|" + ("k" * LONG_MATCH_KEY_SUFFIX_LENGTH))

    assert await sink.publish(event) is False

    sink._redis = _FakeRedis()
    result = await sink.publish(event)
    assert result is True
    assert sink._redis.calls
    expected_safe_key = event.match_key.replace("|", ".")[:60]
    assert sink._redis.calls[0][0] == f"odds.football.{expected_safe_key}"

    sink._redis = _FakeRedis(should_fail=True)
    assert await sink.publish(event) is False
    metrics = sink.get_metrics()
    assert "published" in metrics and "errors" in metrics


@pytest.mark.asyncio
async def test_n8n_serialize_send_and_retry_queue():
    event = _make_event(with_two_sources=True)

    sink = N8NWebhookSink()
    sink._post = AsyncMock(return_value=True)
    sent = await sink.send(event)
    assert sent is True
    payload = sink._post.await_args.args[0]
    assert payload["two_sources"] is True
    assert payload["status"] == "live"
    assert sink._retry_queue.qsize() == 0

    sink._post = AsyncMock(return_value=False)
    sent = await sink.send(event)
    assert sent is False
    assert sink._retry_queue.qsize() == 1


@pytest.mark.asyncio
async def test_n8n_enqueue_retry_when_queue_full_drops_oldest():
    sink = N8NWebhookSink()
    sink._retry_queue = asyncio.Queue(maxsize=1)
    await sink._enqueue_retry({"match_key": "old"})

    await sink._enqueue_retry({"match_key": "new"})
    item = sink._retry_queue.get_nowait()
    assert item["payload"]["match_key"] == "new"


@pytest.mark.asyncio
async def test_n8n_post_success_http_error_and_timeout():
    sink = N8NWebhookSink()

    sink._get_session = AsyncMock(return_value=_FakeSession(status=200))
    assert await sink._post({"match_key": "ok"}) is True

    sink._get_session = AsyncMock(return_value=_FakeSession(status=500))
    assert await sink._post({"match_key": "err"}) is False

    sink._get_session = AsyncMock(return_value=_FakeSession(exc=asyncio.TimeoutError()))
    assert await sink._post({"match_key": "timeout"}) is False


@pytest.mark.asyncio
async def test_n8n_retry_worker_requeues_failed_item():
    sink = N8NWebhookSink()
    sink._post = AsyncMock(return_value=False)
    await sink._enqueue_retry({"match_key": "k1"})
    item = sink._retry_queue.get_nowait()
    item["next_retry"] = time.time() - 1
    sink._retry_queue.put_nowait(item)

    worker = asyncio.create_task(sink.retry_worker())
    await asyncio.sleep(0.05)
    worker.cancel()
    with pytest.raises(asyncio.CancelledError):
        await worker

    assert sink._retry_queue.qsize() == 1
    item = sink._retry_queue.get_nowait()
    assert item["attempts"] == 1

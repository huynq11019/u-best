"""
Redis Pub/Sub sink (Step 9).
Publish MergedEvent lên channel odds.<sport>.<match_key>.
Payload gồm schema_version để consumer tương thích ngược.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Optional

import redis.asyncio as aioredis

from normalizer.schema import MergedEvent

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CHANNEL_PREFIX = os.getenv("REDIS_CHANNEL_PREFIX", "odds")

_metrics = {"published": 0, "errors": 0}


class RedisPubSubSink:
    def __init__(self):
        self._redis: Optional[aioredis.Redis] = None

    async def connect(self) -> None:
        self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        await self._redis.ping()
        logger.info("redis_sink: connected to %s", REDIS_URL)

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()

    def _channel(self, event: MergedEvent) -> str:
        # channel: odds.football.<match_key_truncated>
        safe_key = event.match_key.replace("|", ".")[:60]
        return f"{CHANNEL_PREFIX}.football.{safe_key}"

    async def publish(self, event: MergedEvent) -> bool:
        if not self._redis:
            logger.warning("redis_sink: not connected, skipping publish")
            return False
        try:
            payload = json.dumps({
                "schema_version": event.schema_version,
                "match_key": event.match_key,
                "league": event.league,
                "home_team": event.home_team,
                "away_team": event.away_team,
                "status": event.status.value,
                "score": {"home": event.score.home, "away": event.score.away} if event.score else None,
                "minute": event.minute,
                "source_markets": event.source_markets,
                "source_ids": event.source_ids,
                "merged_at": event.merged_at,
                "two_sources": event.has_both_sources(),
                "published_at": time.time(),
            })
            channel = self._channel(event)
            await self._redis.publish(channel, payload)
            _metrics["published"] += 1
            return True
        except Exception as e:
            logger.error("redis_sink: publish error: %s", e)
            _metrics["errors"] += 1
            return False

    def get_metrics(self) -> dict:
        return dict(_metrics)

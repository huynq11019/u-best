"""
State cache (Step 7).
Dùng Redis để lưu snapshot odds mới nhất, tránh publish duplicate.
Idempotency key = match_key + market_type + selection_label + source + line.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict
from typing import Optional

import redis.asyncio as aioredis

from normalizer.schema import MergedEvent

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MATCH_TTL = int(os.getenv("MATCH_TTL_SECONDS", "10800"))  # 3 giờ


def _idempotency_key(match_key: str, source: str, market_type: str,
                     label: str, line: Optional[float]) -> str:
    raw = f"{match_key}:{source}:{market_type}:{label}:{line}"
    return hashlib.md5(raw.encode()).hexdigest()


class StateCache:
    def __init__(self):
        self._redis: Optional[aioredis.Redis] = None

    async def connect(self) -> None:
        self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        await self._redis.ping()
        logger.info("state_cache: connected to Redis at %s", REDIS_URL)

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()

    async def is_duplicate(self, event: MergedEvent) -> bool:
        """
        Kiểm tra event có trùng với lần publish trước không.
        So sánh bằng hash của toàn bộ source_markets payload.
        """
        if not self._redis:
            return False
        cache_key = f"snap:{event.match_key}"
        payload_hash = hashlib.md5(
            json.dumps(event.source_markets, sort_keys=True).encode()
        ).hexdigest()

        stored = await self._redis.get(cache_key)
        if stored == payload_hash:
            return True

        await self._redis.setex(cache_key, MATCH_TTL, payload_hash)
        return False

    async def save_snapshot(self, event: MergedEvent) -> None:
        """Lưu snapshot MergedEvent để tra cứu hoặc debug."""
        if not self._redis:
            return
        key = f"match:{event.match_key}"
        payload = json.dumps({
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
            "schema_version": event.schema_version,
        })
        await self._redis.setex(key, MATCH_TTL, payload)

    async def get_all_live_keys(self) -> list[str]:
        if not self._redis:
            return []
        keys = await self._redis.keys("match:*")
        return [k.removeprefix("match:") for k in keys]

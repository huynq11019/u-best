"""
n8n Webhook sink (Step 8).
POST merged event → n8n webhook để n8n batch upsert vào Google Sheets.
Có in-memory retry queue để absorb burst và recover khi n8n tạm down.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import time
from dataclasses import asdict
from typing import Optional

import aiohttp
import certifi

from normalizer.schema import MergedEvent

logger = logging.getLogger(__name__)

N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "http://localhost:5678/webhook/odds-aggregator")
MAX_RETRY_QUEUE = 500
MAX_RETRIES = 3

_metrics = {"sent": 0, "failed": 0, "queued": 0}


def _serialize_event(event: MergedEvent) -> dict:
    return {
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
        "two_sources": event.has_both_sources(),
    }


class N8NWebhookSink:
    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        self._retry_queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_RETRY_QUEUE)
        self._ssl_context = ssl.create_default_context(cafile=certifi.where())

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=8)
            # Create a custom connector with our SSL context
            connector = aiohttp.TCPConnector(ssl=self._ssl_context)
            self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self._session

    async def send(self, event: MergedEvent) -> bool:
        """Gửi event lên n8n webhook. Nếu fail → đẩy vào retry queue."""
        payload = _serialize_event(event)
        success = await self._post(payload)
        if not success:
            await self._enqueue_retry(payload)
        return success

    async def _post(self, payload: dict, attempt: int = 1) -> bool:
        try:
            session = await self._get_session()
            async with session.post(N8N_WEBHOOK_URL, json=payload) as resp:
                if resp.status < 300:
                    _metrics["sent"] += 1
                    logger.info("n8n sink: successfully sent match %s", payload.get("match_key"))
                    return True
                logger.warning("n8n sink: HTTP %d on attempt %d", resp.status, attempt)
                _metrics["failed"] += 1
                return False
        except asyncio.TimeoutError:
            logger.warning("n8n sink: timeout on attempt %d", attempt)
            _metrics["failed"] += 1
            return False
        except Exception as e:
            logger.warning("n8n sink: error on attempt %d: %s", attempt, e)
            _metrics["failed"] += 1
            return False

    async def _enqueue_retry(self, payload: dict) -> None:
        if self._retry_queue.full():
            logger.warning("n8n sink: retry queue full, dropping oldest")
            try:
                self._retry_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            self._retry_queue.put_nowait({"payload": payload, "attempts": 0, "next_retry": time.time()})
            _metrics["queued"] += 1
        except asyncio.QueueFull:
            pass

    async def retry_worker(self) -> None:
        """Background worker xử lý retry queue liên tục."""
        while True:
            try:
                item = await asyncio.wait_for(self._retry_queue.get(), timeout=5.0)
                now = time.time()
                if item["next_retry"] > now:
                    # Chưa đến lúc retry — đẩy lại và ngủ
                    await self._retry_queue.put(item)
                    await asyncio.sleep(1)
                    continue

                success = await self._post(item["payload"], attempt=item["attempts"] + 1)
                if not success and item["attempts"] < MAX_RETRIES:
                    delay = 2 ** item["attempts"]  # 1s, 2s, 4s
                    item["attempts"] += 1
                    item["next_retry"] = time.time() + delay
                    await self._retry_queue.put(item)
                elif not success:
                    logger.error("n8n sink: gave up after %d retries for key %s",
                                 MAX_RETRIES, item["payload"].get("match_key"))

            except asyncio.TimeoutError:
                pass
            except Exception as e:
                logger.exception("n8n retry worker error: %s", e)

    def get_metrics(self) -> dict:
        return {**_metrics, "retry_queue_size": self._retry_queue.qsize()}

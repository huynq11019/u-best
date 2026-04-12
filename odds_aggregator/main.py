"""
Main entrypoint — khởi chạy toàn bộ aggregator pipeline.
Wires: SABA ingestor + 1xBET ingestor → queue → normalize → merge → state cache → sinks
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env từ thư mục hiện tại
load_dotenv(Path(__file__).parent / ".env")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

from api.server import create_api_app, API_HOST, API_PORT
from ingestors.base import BaseIngestor
from ingestors.saba import SABAIngestor
from ingestors.xbet import XBETIngestor
from merger.merger import Merger
from normalizer.normalizer import normalize
from normalizer.schema import CanonicalMatch
from sinks.n8n_webhook import N8NWebhookSink
from sinks.redis_pubsub import RedisPubSubSink
from state.cache import StateCache


class AggregatorApp:
    def __init__(self):
        self.merger = Merger()
        self.state_cache = StateCache()
        self.n8n_sink = N8NWebhookSink()
        self.redis_sink = RedisPubSubSink()
        self.ingestors: list[BaseIngestor] = [
            SABAIngestor(poll_interval=float(os.getenv("SABA_POLL_INTERVAL", "4"))),
            XBETIngestor(
                list_poll_interval=float(os.getenv("XBET_LIST_POLL_INTERVAL", "8")),
                detail_poll_interval=float(os.getenv("XBET_DETAIL_POLL_INTERVAL", "5")),
            ),
        ]
        self._queue: asyncio.Queue[CanonicalMatch] = asyncio.Queue(maxsize=2000)
        self._running = True

    async def _pipeline_worker(self) -> None:
        """
        Main worker: dequeue → normalize → merge → dedup → publish sinks.
        """
        cleanup_counter = 0
        CLEANUP_EVERY = 500  # xóa stale mỗi N events

        while self._running:
            try:
                raw_match = await asyncio.wait_for(self._queue.get(), timeout=1.0)

                # Step 5: Normalize
                match = normalize(raw_match)
                if match is None:
                    continue

                # Step 6: Merge
                event = self.merger.upsert(match)

                # Step 7: Dedup check
                if await self.state_cache.is_duplicate(event):
                    continue

                # Persist snapshot
                await self.state_cache.save_snapshot(event)

                # Step 8 & 9: Publish to n8n only (Redis disabled as requested)
                await asyncio.gather(
                    self.n8n_sink.send(event),
                    # self.redis_sink.publish(event),
                    return_exceptions=True,
                )

                # Periodic cleanup
                cleanup_counter += 1
                if cleanup_counter >= CLEANUP_EVERY:
                    cleanup_counter = 0
                    self.merger.cleanup_stale(float(os.getenv("MATCH_TTL_SECONDS", "10800")))

            except asyncio.TimeoutError:
                pass
            except Exception as e:
                logger.exception("pipeline worker error: %s", e)

    async def run(self) -> None:
        # Connect shared services
        await self.state_cache.connect()
        await self.redis_sink.connect()

        logger.info("Starting Live Odds Aggregator MVP")

        tasks = []

        # Ingestor polling loops
        for ing in self.ingestors:
            tasks.append(asyncio.create_task(ing.run(self._queue), name=f"ingestor_{ing.name}"))

        # n8n retry worker
        tasks.append(asyncio.create_task(self.n8n_sink.retry_worker(), name="n8n_retry"))

        # Pipeline worker (singleton — all in async, no threading needed)
        tasks.append(asyncio.create_task(self._pipeline_worker(), name="pipeline"))

        # HTTP API server
        from aiohttp import web
        api_app = create_api_app(self)
        runner = web.AppRunner(api_app)
        await runner.setup()
        site = web.TCPSite(runner, API_HOST, API_PORT)
        await site.start()
        logger.info("API server started at http://%s:%d", API_HOST, API_PORT)

        # Graceful shutdown
        loop = asyncio.get_running_loop()
        stop_event = asyncio.Event()

        def _shutdown(sig):
            logger.info("Received signal %s — shutting down...", sig.name)
            stop_event.set()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _shutdown, sig)

        await stop_event.wait()

        self._running = False
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

        await runner.cleanup()
        await self.state_cache.close()
        await self.redis_sink.close()
        logger.info("Aggregator shut down cleanly.")


if __name__ == "__main__":
    app = AggregatorApp()
    asyncio.run(app.run())

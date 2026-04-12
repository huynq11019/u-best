"""
Internal ops API (Step 10).
Health endpoint, stats endpoint, token reload endpoint.
"""
from __future__ import annotations

import json
import logging
import os
from typing import TYPE_CHECKING

from aiohttp import web

if TYPE_CHECKING:
    from main import AggregatorApp

logger = logging.getLogger(__name__)

API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8080"))


def create_api_app(aggregator: "AggregatorApp") -> web.Application:
    app = web.Application()

    async def health(request: web.Request) -> web.Response:
        healths = [ing.get_health() for ing in aggregator.ingestors]
        all_healthy = all(h["healthy"] for h in healths)
        return web.json_response({
            "status": "ok" if all_healthy else "degraded",
            "ingestors": healths,
        }, status=200 if all_healthy else 207)

    async def stats(request: web.Request) -> web.Response:
        merger_stats = aggregator.merger.get_stats()
        n8n_metrics = aggregator.n8n_sink.get_metrics()
        redis_metrics = aggregator.redis_sink.get_metrics()
        from normalizer.normalizer import get_metrics as norm_metrics
        return web.json_response({
            "merger": merger_stats,
            "n8n": n8n_metrics,
            "redis_pubsub": redis_metrics,
            "normalizer": norm_metrics(),
        })

    async def reload_token(request: web.Request) -> web.Response:
        """Hot-reload SABA token từ env hoặc request body."""
        body = await request.json() if request.content_length else {}
        new_token = body.get("token")

        saba_ingestors = [ing for ing in aggregator.ingestors if ing.name == "saba"]
        if not saba_ingestors:
            return web.json_response({"error": "SABA ingestor not found"}, status=404)

        for ing in saba_ingestors:
            if new_token:
                import os
                os.environ["SABA_TOKEN"] = new_token
            ing.reload_token()

        return web.json_response({"status": "ok", "message": "SABA token reloaded"})

    async def live_matches(request: web.Request) -> web.Response:
        """Trả về danh sách match keys đang live trong cache."""
        keys = await aggregator.state_cache.get_all_live_keys()
        return web.json_response({"count": len(keys), "match_keys": keys})

    app.router.add_get("/health", health)
    app.router.add_get("/stats", stats)
    app.router.add_get("/live", live_matches)
    app.router.add_post("/admin/reload-token", reload_token)

    return app

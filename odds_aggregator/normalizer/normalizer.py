"""
Normalizer (Step 5).
Nhận CanonicalMatch thô từ ingestors, validate schema, lọc record lỗi,
ghi metric lỗi parse.
"""
from __future__ import annotations

import dataclasses
import logging
import time
from dataclasses import asdict

from normalizer.schema import CanonicalMatch, Market, MarketType, Source

logger = logging.getLogger(__name__)

# Metric counters (simple in-proc, có thể replace bằng prometheus sau)
_metrics: dict[str, int] = {
    "parse_errors": 0,
    "missing_markets": 0,
    "normalized_total": 0,
}


def get_metrics() -> dict:
    return dict(_metrics)


def normalize(match: CanonicalMatch) -> CanonicalMatch | None:
    """
    Validate và chuẩn hóa một CanonicalMatch.
    Trả về None nếu record không dùng được.
    """
    # Bắt buộc có tên đội và giải
    if not match.home_team or match.home_team == "unknown":
        _metrics["parse_errors"] += 1
        logger.debug("normalizer: skip match, missing home_team key=%s", match.match_key)
        return None
    if not match.away_team or match.away_team == "unknown":
        _metrics["parse_errors"] += 1
        return None

    # Warn nếu không có market nào
    total_markets = sum(len(v) for v in match.source_markets.values())
    if total_markets == 0:
        _metrics["missing_markets"] += 1
        logger.debug("normalizer: match has no markets key=%s", match.match_key)

    # Clamp odds về dải hợp lý [1.0, 1000.0]
    for source, markets in match.source_markets.items():
        for market in markets:
            valid_sels = []
            for sel in market.selections:
                if 1.0 <= sel.odds <= 1000.0:
                    valid_sels.append(sel)
                else:
                    logger.debug("normalizer: clamped invalid odds %.2f for %s", sel.odds, match.match_key)
            market.selections = valid_sels

    # Đảm bảo ingested_at
    if not match.ingested_at:
        match.ingested_at = time.time()

    _metrics["normalized_total"] += 1
    return match


def market_to_dict(market: Market) -> dict:
    """Serialize Market thành plain dict cho downstream sinks."""
    return {
        "market_type": market.market_type.value,
        "line": market.line,
        "source": market.source.value,
        "source_ts": market.source_ts,
        "selections": [
            {"label": s.label, "odds": s.odds, "line": s.line}
            for s in market.selections
        ],
    }

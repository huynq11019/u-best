"""
Canonical schema cho Live Odds Aggregator.
Step 1 - blocking: định nghĩa các data model dùng chung toàn pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Source(str, Enum):
    SABA = "saba"
    XBET = "1xbet"


class MarketType(str, Enum):
    ONE_X_TWO = "1x2"
    OVER_UNDER = "ou"
    ASIAN_HANDICAP = "ah"


class MatchStatus(str, Enum):
    LIVE = "live"
    NOT_STARTED = "not_started"
    FINISHED = "finished"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


@dataclass
class Score:
    home: int
    away: int


@dataclass
class Selection:
    """Một lựa chọn trong một market (vd: Over 2.5 @ 1.85)."""
    label: str           # "over" | "under" | "home" | "draw" | "away"
    odds: float
    line: Optional[float] = None  # handicap/ou line, vd: 2.5


@dataclass
class Market:
    """Một dòng kèo cụ thể."""
    market_type: MarketType
    selections: list[Selection]
    source: Source
    source_ts: float     # unix timestamp khi lấy từ provider
    line: Optional[float] = None


@dataclass
class CanonicalMatch:
    """
    Một trận đấu đã chuẩn hóa. Là unit dữ liệu cốt lõi chạy qua toàn pipeline.
    Mỗi source giữ markets riêng — không overwrite nhau.
    """
    # Identity
    match_key: str                  # league|home_team|away_team|start_window (normalized)
    league: str
    home_team: str
    away_team: str

    # State
    status: MatchStatus
    score: Optional[Score]
    minute: Optional[int]           # phút thi đấu

    # Markets theo từng nguồn — giữ riêng để so sánh surewin
    source_markets: dict[Source, list[Market]] = field(default_factory=dict)

    # Metadata
    source_ids: dict[Source, str] = field(default_factory=dict)  # id gốc từng nguồn
    ingested_at: float = 0.0        # unix timestamp khi aggregator xử lý


@dataclass
class MergedEvent:
    """
    Output của merger: một trận đã merge từ đa nguồn.
    Được publish lên Redis và n8n.
    """
    match_key: str
    league: str
    home_team: str
    away_team: str
    status: MatchStatus
    score: Optional[Score]
    minute: Optional[int]
    source_markets: dict[str, list[dict]]  # source.value -> list of market dicts
    source_ids: dict[str, str]
    merged_at: float
    schema_version: str = "1.0"

    def has_both_sources(self) -> bool:
        return len(self.source_markets) >= 2

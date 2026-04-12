"""
Merger layer (Step 6).
Ghép trận từ 2 nguồn bằng fuzzy match tên đội + league.
Giữ source_markets riêng biệt — không overwrite.
Gắn metadata chênh lệch odds để lọc surewin downstream.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from rapidfuzz import fuzz

from normalizer.normalizer import market_to_dict
from normalizer.schema import CanonicalMatch, MarketType, MergedEvent, Source

logger = logging.getLogger(__name__)

# Ngưỡng similarity để ghép trận (0-100)
TEAM_MATCH_THRESHOLD = 80
LEAGUE_MATCH_THRESHOLD = 70

# Alias dictionary cho các trường hợp tên khác biệt phổ biến
TEAM_ALIASES: dict[str, str] = {
    "man utd": "manchester united",
    "man united": "manchester united",
    "man city": "manchester city",
    "psg": "paris saint-germain",
    "atletico": "atletico madrid",
    "inter": "inter milan",
    "barca": "barcelona",
    "fc barcelona": "barcelona",
    "liverpool fc": "liverpool",
    "arsenal fc": "arsenal",
    "chelsea fc": "chelsea",
}


def _normalize(name: str) -> str:
    name = name.strip().lower()
    return TEAM_ALIASES.get(name, name)


def _team_similarity(a: str, b: str) -> float:
    return fuzz.token_sort_ratio(_normalize(a), _normalize(b))


def _league_similarity(a: str, b: str) -> float:
    return fuzz.token_sort_ratio(_normalize(a), _normalize(b))


def _matches_same_fixture(a: CanonicalMatch, b: CanonicalMatch) -> bool:
    """Kiểm tra 2 CanonicalMatch có phải cùng 1 trận thực tế không."""
    home_sim = _team_similarity(a.home_team, b.home_team)
    away_sim = _team_similarity(a.away_team, b.away_team)
    league_sim = _league_similarity(a.league, b.league)

    # Cũng kiểm tra cross-pair (home↔away có thể bị đảo ở một số nguồn)
    home_swap = _team_similarity(a.home_team, b.away_team)
    away_swap = _team_similarity(a.away_team, b.home_team)
    cross_sim = (home_swap + away_swap) / 2

    direct_sim = (home_sim + away_sim) / 2

    best_sim = max(direct_sim, cross_sim)
    return best_sim >= TEAM_MATCH_THRESHOLD and league_sim >= LEAGUE_MATCH_THRESHOLD


def _compute_odds_diff(merged: "MergedStore") -> Optional[float]:
    """
    Tính chênh lệch odds O/U giữa 2 nguồn cho cùng một line.
    Dùng để phát hiện surewin opportunities downstream.
    """
    saba_markets = merged.source_markets.get(Source.SABA.value, [])
    xbet_markets = merged.source_markets.get(Source.XBET.value, [])

    saba_ou = [m for m in saba_markets if m["market_type"] == MarketType.OVER_UNDER.value]
    xbet_ou = [m for m in xbet_markets if m["market_type"] == MarketType.OVER_UNDER.value]

    if not saba_ou or not xbet_ou:
        return None

    # Lấy line đầu tiên từ mỗi nguồn để so sánh demo
    saba_over = next((s["odds"] for s in saba_ou[0]["selections"] if s["label"] == "over"), None)
    xbet_under = next((s["odds"] for s in xbet_ou[0]["selections"] if s["label"] == "under"), None)

    if saba_over and xbet_under:
        return round(saba_over + xbet_under - 2.0, 4)  # > 0 = potential surewin margin

    return None


class MergedStore:
    """Trạng thái merge của một trận đang live."""
    def __init__(self, primary: CanonicalMatch):
        self.match_key = primary.match_key
        self.league = primary.league
        self.home_team = primary.home_team
        self.away_team = primary.away_team
        self.status = primary.status
        self.score = primary.score
        self.minute = primary.minute
        self.source_markets: dict[str, list[dict]] = {}
        self.source_ids: dict[str, str] = {}
        self.last_updated = primary.ingested_at

        self._apply(primary)

    def _apply(self, match: CanonicalMatch) -> None:
        for source, markets in match.source_markets.items():
            self.source_markets[source.value] = [market_to_dict(m) for m in markets]
        for source, sid in match.source_ids.items():
            self.source_ids[source.value] = sid
        # Update match-level fields với data mới nhất
        self.status = match.status
        if match.score:
            self.score = match.score
        if match.minute is not None:
            self.minute = match.minute
        self.last_updated = match.ingested_at

    def to_event(self) -> MergedEvent:
        score_dict = None
        if self.score:
            score_dict = self.score

        return MergedEvent(
            match_key=self.match_key,
            league=self.league,
            home_team=self.home_team,
            away_team=self.away_team,
            status=self.status,
            score=score_dict,
            minute=self.minute,
            source_markets=self.source_markets,
            source_ids=self.source_ids,
            merged_at=time.time(),
        )


class Merger:
    """
    Duy trì tập hợp trận live và merge matches từ nhiều nguồn.
    Thread-safe qua asyncio single-threaded model.
    """

    def __init__(self):
        self._store: dict[str, MergedStore] = {}  # match_key → MergedStore

    def upsert(self, match: CanonicalMatch) -> MergedEvent:
        """
        Thêm hoặc cập nhật một match vào store.
        Nếu match_key đã tồn tại → merge source_markets.
        Nếu chưa → tìm bằng fuzzy match, nếu không có → tạo mới.
        """
        # 1. Exact key match (fast path)
        if match.match_key in self._store:
            self._store[match.match_key]._apply(match)
            return self._store[match.match_key].to_event()

        # 2. Fuzzy match trong store hiện tại
        best_key = self._fuzzy_find(match)
        if best_key:
            logger.debug("merger: fuzzy matched '%s' → '%s'", match.match_key, best_key)
            merged = self._store[best_key]
            merged._apply(match)
            # Cũng index bằng key mới để lần sau nhanh hơn
            self._store[match.match_key] = merged
            return merged.to_event()

        # 3. Tạo mới
        self._store[match.match_key] = MergedStore(match)
        return self._store[match.match_key].to_event()

    def _fuzzy_find(self, match: CanonicalMatch) -> Optional[str]:
        """Tìm trận gần nhất trong store bằng fuzzy matching."""
        for key, stored_match in self._store.items():
            # Tạo CanonicalMatch tạm để sử dụng _matches_same_fixture
            candidate = CanonicalMatch(
                match_key=key,
                league=stored_match.league,
                home_team=stored_match.home_team,
                away_team=stored_match.away_team,
                status=stored_match.status,
                score=stored_match.score,
                minute=stored_match.minute,
            )
            if _matches_same_fixture(match, candidate):
                return key
        return None

    def cleanup_stale(self, ttl_seconds: float = 10800) -> int:
        """Xóa trận không được cập nhật quá TTL."""
        now = time.time()
        stale_keys = [k for k, v in self._store.items() if now - v.last_updated > ttl_seconds]
        for k in stale_keys:
            del self._store[k]
        if stale_keys:
            logger.info("merger: cleaned up %d stale matches", len(stale_keys))
        return len(stale_keys)

    def get_stats(self) -> dict:
        now = time.time()
        two_source = sum(1 for v in self._store.values() if len(v.source_markets) >= 2)
        return {
            "total_live_matches": len(self._store),
            "two_source_matches": two_source,
            "avg_age_seconds": round(
                sum(now - v.last_updated for v in self._store.values()) / max(len(self._store), 1), 1
            ),
        }

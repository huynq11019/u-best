"""
Unit tests — parser, normalizer, merger (Step 11).
Chạy: pytest tests/ -v
"""
import time

import pytest

from normalizer.schema import (
    CanonicalMatch, Market, MarketType, MatchStatus, Score, Selection, Source
)
from normalizer.normalizer import normalize, get_metrics
from merger.merger import Merger, _team_similarity, _league_similarity


# ─── Fixtures ────────────────────────────────────────────────────────────────

def make_match(
    match_key="premier league|man utd|liverpool",
    league="Premier League",
    home="Man Utd",
    away="Liverpool",
    source=Source.SABA,
    with_markets=True,
) -> CanonicalMatch:
    markets = []
    if with_markets:
        markets = [
            Market(
                market_type=MarketType.OVER_UNDER,
                selections=[
                    Selection("over", 1.85, 2.5),
                    Selection("under", 2.05, 2.5),
                ],
                source=source,
                source_ts=time.time(),
                line=2.5,
            )
        ]
    return CanonicalMatch(
        match_key=match_key,
        league=league,
        home_team=home,
        away_team=away,
        status=MatchStatus.LIVE,
        score=Score(1, 0),
        minute=35,
        source_markets={source: markets},
        source_ids={source: "12345"},
        ingested_at=time.time(),
    )


# ─── Normalizer Tests ─────────────────────────────────────────────────────────

class TestNormalizer:
    def test_valid_match_passes(self):
        m = make_match()
        result = normalize(m)
        assert result is not None

    def test_missing_home_team_rejected(self):
        m = make_match(home="unknown")
        result = normalize(m)
        assert result is None

    def test_missing_away_team_rejected(self):
        m = make_match(away="unknown")
        result = normalize(m)
        assert result is None

    def test_invalid_odds_clamped(self):
        m = make_match()
        # Inject invalid odds
        m.source_markets[Source.SABA][0].selections.append(
            Selection("over", 0.5, 2.5)  # odds < 1.0 → invalid
        )
        result = normalize(m)
        assert result is not None
        sels = result.source_markets[Source.SABA][0].selections
        assert all(1.0 <= s.odds <= 1000.0 for s in sels)

    def test_no_market_passes_with_warning(self):
        m = make_match(with_markets=False)
        result = normalize(m)
        assert result is not None


# ─── Fuzzy Matching Tests ──────────────────────────────────────────────────────

class TestFuzzyMatching:
    def test_exact_match(self):
        assert _team_similarity("Manchester United", "Manchester United") == 100.0

    def test_alias_match(self):
        # "Man Utd" alias → "manchester united"
        sim = _team_similarity("Man Utd", "Manchester United")
        assert sim >= 70  # qua alias dict

    def test_different_teams(self):
        sim = _team_similarity("Liverpool", "Arsenal")
        assert sim < 80

    def test_league_similarity(self):
        sim = _league_similarity("Premier League", "England. Premier League")
        assert sim >= 60


# ─── Merger Tests ─────────────────────────────────────────────────────────────

class TestMerger:
    def test_same_key_merges(self):
        merger = Merger()
        m1 = make_match(source=Source.SABA)
        m2 = make_match(source=Source.XBET)
        merger.upsert(m1)
        event = merger.upsert(m2)
        assert len(event.source_markets) == 2
        assert event.has_both_sources()

    def test_fuzzy_match_merges(self):
        merger = Merger()
        # SABA match
        m_saba = make_match(
            match_key="premier league|manchester united|liverpool",
            home="Manchester United",
            source=Source.SABA,
        )
        # 1xBET match — slightly different key
        m_xbet = make_match(
            match_key="premier league|man united|liverpool fc",
            home="Man United",
            away="Liverpool FC",
            source=Source.XBET,
        )
        merger.upsert(m_saba)
        event = merger.upsert(m_xbet)
        # Phải merged vào cùng 1 record
        assert event.has_both_sources()

    def test_different_matches_not_merged(self):
        merger = Merger()
        m1 = make_match(home="Arsenal", away="Chelsea", match_key="pl|arsenal|chelsea", source=Source.SABA)
        m2 = make_match(home="Liverpool", away="Man City", match_key="pl|liverpool|man city", source=Source.XBET)
        merger.upsert(m1)
        event = merger.upsert(m2)
        assert not event.has_both_sources()

    def test_cleanup_stale(self):
        merger = Merger()
        m = make_match()
        m.ingested_at = time.time() - 20000  # very stale
        merger.upsert(m)
        removed = merger.cleanup_stale(ttl_seconds=10800)
        assert removed >= 1

    def test_stats(self):
        merger = Merger()
        m1 = make_match(source=Source.SABA)
        m2 = make_match(source=Source.XBET)
        merger.upsert(m1)
        merger.upsert(m2)
        stats = merger.get_stats()
        assert "total_live_matches" in stats


# ─── Schema Tests ─────────────────────────────────────────────────────────────

class TestSchema:
    def test_merged_event_has_both_sources(self):
        merger = Merger()
        m1 = make_match(source=Source.SABA)
        m2 = make_match(source=Source.XBET)
        merger.upsert(m1)
        event = merger.upsert(m2)
        assert event.has_both_sources()
        assert event.schema_version == "1.0"

    def test_score_preserved(self):
        m = make_match()
        assert m.score.home == 1
        assert m.score.away == 0

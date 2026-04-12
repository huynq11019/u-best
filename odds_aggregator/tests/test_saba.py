"""
Unit tests cho SABA Ingestor.
Chạy bằng lệnh: pytest tests/test_saba.py -v
"""
import pytest
import time
from unittest.mock import patch, MagicMock, AsyncMock
from ingestors.saba import SABAIngestor
from normalizer.schema import MarketType, MatchStatus

@pytest.fixture
def saba():
    s = SABAIngestor(poll_interval=1.0)
    s._token = "test-token"
    return s

@patch("ingestors.saba.SABAIngestor._show_all_odds", new_callable=AsyncMock)
@patch("ingestors.saba.SABAIngestor._get_markets", new_callable=AsyncMock)
@pytest.mark.asyncio
async def test_fetch_matches(mock_get_markets, mock_show_all_odds, saba):
    # Mock data cho ShowAllOdds (Live match)
    mock_show_all_odds.return_value = {
        "ErrorCode": 0,
        "Data": {
            "TeamN": {
                "10": "Man Utd",
                "20": "Liverpool"
            },
            "LeagueN": {
                "100": "Premier League"
            },
            "NewMatch": [
                {
                    "MatchId": 12345,
                    "TeamId1": "10",
                    "TeamId2": "20",
                    "LeagueId": "100",
                    "T1V": "1",
                    "T2V": "0",
                    "MaT": "l",
                    "Ktm": 45
                }
            ]
        }
    }

    # Mock data cho GetMarkets (Chi tiết kèo HDP, OU, 1X2)
    mock_get_markets.return_value = [
        {
            "BetType": 3,  # O/U
            "Hdp": 2.5,
            "Price1": 1.85, # Over
            "Price2": 2.05  # Under
        },
        {
            "BetType": 1,  # HDP (Asian Handicap)
            "Hdp": -0.5,
            "Price1": 1.95, # Home
            "Price2": 1.95  # Away
        },
        {
            "BetType": 5,  # 1X2
            "Price1": 2.00, # Home
            "Price2": 3.80, # Away
            "Price3": 3.50  # Draw
        }
    ]

    # Chúng ta sử dụng context manager để mock session vì fetch_matches gọi await self._get_session()
    with patch("ingestors.saba.SABAIngestor._get_session", new_callable=AsyncMock) as mock_session:
        matches = await saba.fetch_matches()

    assert len(matches) == 1
    match = matches[0]
    
    assert match.home_team == "Man Utd"
    assert match.away_team == "Liverpool"
    assert match.league == "Premier League"
    assert match.status == MatchStatus.LIVE
    assert match.score is not None
    assert match.score.home == 1
    assert match.score.away == 0
    assert match.minute == 45
    
    source_markets = match.source_markets[saba.name]
    assert len(source_markets) == 3
    
    # Kiểm tra O/U Market
    ou_market = next(m for m in source_markets if m.market_type == MarketType.OVER_UNDER)
    assert ou_market.line == 2.5
    assert len(ou_market.selections) == 2
    assert ou_market.selections[0].label == "over"
    assert ou_market.selections[0].odds == 1.85

    # Kiểm tra 1x2 Market
    x2_market = next(m for m in source_markets if m.market_type == MarketType.ONE_X_TWO)
    assert len(x2_market.selections) == 3
    home = next(s for s in x2_market.selections if s.label == "home")
    draw = next(s for s in x2_market.selections if s.label == "draw")
    away = next(s for s in x2_market.selections if s.label == "away")
    assert home.odds == 2.00
    assert draw.odds == 3.50
    assert away.odds == 3.80

    # Kiểm tra Asian Handicap
    ah_market = next(m for m in source_markets if m.market_type == MarketType.ASIAN_HANDICAP)
    assert ah_market.line == -0.5
    assert len(ah_market.selections) == 2
    home_ah = next(s for s in ah_market.selections if s.label == "home")
    assert home_ah.odds == 1.95


@pytest.mark.asyncio
async def test_auth_error_no_token():
    saba = SABAIngestor()
    saba._token = ""
    from ingestors.base import AuthError
    # Mock _refresh_visitor_token để không thực sự chạy Playwright
    # nhưng không gán token mới, để xem nó có raise AuthError không
    with patch("ingestors.saba.SABAIngestor._refresh_visitor_token", new_callable=AsyncMock):
        with pytest.raises(AuthError):
            await saba.fetch_matches()

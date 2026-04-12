"""
Unit tests cho 1xBET Ingestor.
Chạy bằng lệnh: pytest tests/test_xbet.py -v
"""
import pytest
import time
from unittest.mock import patch, MagicMock
from ingestors.xbet import XBETIngestor
from normalizer.schema import MarketType, MatchStatus

@pytest.fixture
def xbet():
    # Khởi tạo ingestor với khoảng thời gian poll tuỳ ý
    return XBETIngestor(list_poll_interval=1.0, detail_poll_interval=1.0)


def test_parse_score(xbet):
    # Dữ liệu giả lập (mock payload) từ API 1xBET
    raw = {
        "SC": {
            "FS": {
                "S1": "2",
                "S2": "1"
            }
        }
    }
    score = xbet._parse_score(raw)
    assert score is not None
    assert score.home == 2
    assert score.away == 1

def test_parse_score_missing(xbet):
    score = xbet._parse_score({})
    assert score is None


def test_parse_markets_from_detail(xbet):
    now = time.time()
    # Dữ liệu giả lập Group Events cho 1 trận đấu
    detail = {
        "GE": [
            {
                "G": 17,  # GROUP_OU_FULL
                "E": [
                    [
                        {"T": 9, "P": 2.5, "C": 1.85},  # OVER 2.5 @ 1.85
                        {"T": 10, "P": 2.5, "C": 2.05}  # UNDER 2.5 @ 2.05
                    ]
                ]
            },
            {
                "G": 1,   # GROUP_1X2
                "E": [
                    [
                        {"T": 1, "C": 2.10},  # HOME WIN @ 2.10
                        {"T": 2, "C": 3.40},  # DRAW @ 3.40
                        {"T": 3, "C": 3.10}   # AWAY WIN @ 3.10
                    ]
                ]
            }
        ]
    }
    
    markets = xbet._parse_markets_from_detail(detail, now)
    
    assert len(markets) == 2
    
    # Kiểm tra O/U Market
    ou_market = next(m for m in markets if m.market_type == MarketType.OVER_UNDER)
    assert ou_market.line == 2.5
    assert len(ou_market.selections) == 2
    over = next(s for s in ou_market.selections if s.label == "over")
    assert over.odds == 1.85
    assert over.line == 2.5
    under = next(s for s in ou_market.selections if s.label == "under")
    assert under.odds == 2.05
    assert under.line == 2.5

    # Kiểm tra 1x2 Market
    x2_market = next(m for m in markets if m.market_type == MarketType.ONE_X_TWO)
    assert len(x2_market.selections) == 3
    home = next(s for s in x2_market.selections if s.label == "home")
    assert home.odds == 2.10


@patch("ingestors.xbet.XBETIngestor._fetch_live_list_sync")
@patch("ingestors.xbet.XBETIngestor._fetch_game_detail_sync")
@pytest.mark.asyncio
async def test_fetch_matches(mock_get_detail, mock_get_list, xbet):
    # Mock data cho API List
    mock_get_list.return_value = [
        {
            "I": 12345,
            "L": "Premier League",
            "O1": "Arsenal",
            "O2": "Chelsea",
            "E": [
                {"T": 1, "C": 2.5},
                {"T": 3, "C": 2.8}
            ]
        }
    ]
    
    # Mock data cho API Detail
    mock_get_detail.return_value = {
        "GE": [
            {
                "G": 17,
                "E": [
                    [
                        {"T": 9, "P": 1.5, "C": 1.5},
                        {"T": 10, "P": 1.5, "C": 2.5}
                    ]
                ]
            }
        ]
    }

    matches = await xbet.fetch_matches()
    
    assert len(matches) == 1
    match = matches[0]
    
    assert match.home_team == "Arsenal"
    assert match.away_team == "Chelsea"
    assert match.league == "Premier League"
    assert match.status == MatchStatus.LIVE
    
    # Matches phải có list O/U (mượn từ API Detail) và 1x2 (mượn từ API List)
    source_markets = match.source_markets[xbet.name]
    assert len(source_markets) == 2
    
    x2_markets = [m for m in source_markets if m.market_type == MarketType.ONE_X_TWO]
    assert len(x2_markets) == 1
    assert len(x2_markets[0].selections) == 2  # Vừa mock trả về 2 kèo: Home và Away

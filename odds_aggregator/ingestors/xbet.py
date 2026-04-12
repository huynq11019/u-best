"""
1xBET ingestor (Step 4).
Khắc phục lỗi WAF 406 Not Acceptable bằng "requests" thay vì "aiohttp/httpx".
Chạy qua asyncio.to_thread để không block loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

import requests

from ingestors.base import BaseIngestor, ProviderError, RateLimitError
from normalizer.schema import (
    CanonicalMatch, Market, MarketType, MatchStatus, Score, Selection, Source
)

logger = logging.getLogger(__name__)

XBET_BASE_URL = os.getenv("XBET_BASE_URL", "https://1xlite-044647.top")
XBET_REFERER = os.getenv("XBET_REFERER", "https://1xlite-044647.top/en/live/football")

# Group IDs trong getGameZip
GROUP_1X2 = 1
GROUP_HANDICAP = 2
GROUP_OU_FULL = 17
GROUP_OU_HALF = 15

# Selection type IDs
T_OVER = 9
T_UNDER = 10
T_HOME_WIN = 1
T_DRAW = 2
T_AWAY_WIN = 3


def _normalize_team_name(name: str) -> str:
    return name.strip().lower()


class XBETIngestor(BaseIngestor):
    name = "1xbet"

    def __init__(self, list_poll_interval: float = 8.0, detail_poll_interval: float = 5.0):
        super().__init__(list_poll_interval)
        self.detail_poll_interval = detail_poll_interval
        self._session: Optional[requests.Session] = None

    def _headers(self) -> dict:
        return {
            "User-Agent": "Mozilla/5.0",
            "Referer": XBET_REFERER,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
        }

    def _get_session(self) -> requests.Session:
        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update(self._headers())
        return self._session

    def _handle_status(self, status: int) -> None:
        if status == 429:
            raise RateLimitError(f"1xBET 429 — rate limited")
        if status >= 500:
            raise ProviderError(f"1xBET {status} server error")
        if status == 406:
            raise ProviderError(f"1xBET 406 Not Acceptable (WAF blocked request)")

    def _fetch_live_list_sync(self) -> list[dict]:
        url = f"{XBET_BASE_URL}/service-api/LiveFeed/Get1x2_VZip?sports=1&count=50&lng=vi&mode=4&country=43&getEmpty=true&noFilterBlockEvent=true"
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": XBET_REFERER}, timeout=10)
        self._handle_status(resp.status_code)
        
        try:
            data = resp.json()
        except Exception:
            raise ProviderError(f"1xBET list API error: Invalid JSON. Text: {resp.text[:100]}")
            
        if not data.get("Success"):
            raise ProviderError(f"1xBET list API error: {data.get('Error')}")
        return data.get("Value", [])

    def _fetch_game_detail_sync(self, game_id: int) -> Optional[dict]:
        url = f"{XBET_BASE_URL}/service-api/LiveFeed/GetGameZip?id={game_id}&lng=vi&isSubGames=true&GroupEvents=true&allEventsZip=true"
        try:
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": XBET_REFERER}, timeout=10)
            self._handle_status(resp.status_code)
            data = resp.json()
            if data.get("Success"):
                return data.get("Value")
        except Exception as e:
            logger.warning("[1xbet] GetGameZip failed for game %d: %s", game_id, e)
        return None

    def _parse_markets_from_detail(self, detail: dict, now: float) -> list[Market]:
        markets = []
        group_events = detail.get("GE", [])

        for group in group_events:
            g_id = group.get("G")
            events_matrix = group.get("E", [])

            if g_id == GROUP_OU_FULL:
                for line_events in events_matrix:
                    selections = []
                    for ev in line_events:
                        t, p, c = ev.get("T"), ev.get("P"), ev.get("C")
                        if t == T_OVER and c:
                            selections.append(Selection("over", float(c), float(p) if p else None))
                        elif t == T_UNDER and c:
                            selections.append(Selection("under", float(c), float(p) if p else None))
                    if selections:
                        line_val = selections[0].line if selections else None
                        markets.append(Market(MarketType.OVER_UNDER, selections, Source.XBET, now, line_val))

            elif g_id == GROUP_1X2:
                selections = []
                t_to_label = {T_HOME_WIN: "home", T_DRAW: "draw", T_AWAY_WIN: "away"}
                for line_events in events_matrix:
                    for ev in line_events:
                        label = t_to_label.get(ev.get("T"))
                        if label and ev.get("C"):
                            selections.append(Selection(label, float(ev["C"])))
                if selections:
                    markets.append(Market(MarketType.ONE_X_TWO, selections, Source.XBET, now))

        return markets

    def _parse_score(self, raw: dict) -> Optional[Score]:
        sc = raw.get("SC", {})
        fs = sc.get("FS", {})
        s1, s2 = fs.get("S1"), fs.get("S2")
        if s1 is not None and s2 is not None:
            try:
                return Score(int(s1), int(s2))
            except (ValueError, TypeError):
                pass
        return None

    async def fetch_matches(self) -> list[CanonicalMatch]:
        raw_list = await asyncio.to_thread(self._fetch_live_list_sync)
        now = time.time()

        # Giới hạn số lượng truy vấn detail đồng thời vì requests chạy qua thread
        # Chỉ lấy detail cho top 10 trận để test hoặc chạy song song
        detail_tasks = [asyncio.to_thread(self._fetch_game_detail_sync, m["I"]) for m in raw_list[:20] if "I" in m]
        details = await asyncio.gather(*detail_tasks)
        detail_map = {m["I"]: d for m, d in zip(raw_list[:20], details) if d}

        matches = []
        for raw_match in raw_list:
            game_id = raw_match.get("I")
            if not game_id:
                continue

            home = raw_match.get("O1", "unknown")
            away = raw_match.get("O2", "unknown")
            league = raw_match.get("L", "unknown")
            score = self._parse_score(raw_match)

            markets: list[Market] = []
            list_1x2_events = raw_match.get("E", [])
            t_to_label = {T_HOME_WIN: "home", T_DRAW: "draw", T_AWAY_WIN: "away"}
            list_1x2_sels = [
                Selection(t_to_label[e["T"]], float(e["C"]))
                for e in list_1x2_events
                if e.get("T") in t_to_label and e.get("C")
            ]
            if list_1x2_sels:
                markets.append(Market(MarketType.ONE_X_TWO, list_1x2_sels, Source.XBET, now))

            detail = detail_map.get(game_id)
            if detail:
                markets.extend(self._parse_markets_from_detail(detail, now))

            match_key = f"{_normalize_team_name(league)}|{_normalize_team_name(home)}|{_normalize_team_name(away)}"

            canonical = CanonicalMatch(
                match_key=match_key,
                league=league,
                home_team=home,
                away_team=away,
                status=MatchStatus.LIVE,
                score=score,
                minute=None,
                source_markets={Source.XBET: markets},
                source_ids={Source.XBET: str(game_id)},
                ingested_at=now,
            )
            matches.append(canonical)

        return matches

    async def health_check(self) -> bool:
        try:
            session = self._get_session()
            url = f"{XBET_BASE_URL}/service-api/LiveFeed/Get1x2_VZip?sports=1&count=1&lng=vi&mode=4&country=43"
            resp = await asyncio.to_thread(session.get, url, timeout=5)
            return resp.status_code < 500
        except Exception:
            return False

    async def close(self) -> None:
        if self._session:
            self._session.close()

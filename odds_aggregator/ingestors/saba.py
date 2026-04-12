"""
SABA ingestor (Step 3).
Gọi ShowAllOdds + GetMarkets, map TeamN/LeagueN, xử lý 401/429/5xx.
Token quản lý thủ công qua env, hỗ trợ hot-reload.
"""
from __future__ import annotations

import logging
import os
import time
import json
from typing import Optional

import aiohttp
from playwright.async_api import async_playwright

from ingestors.base import AuthError, BaseIngestor, ProviderError, RateLimitError
from normalizer.schema import (
    CanonicalMatch, Market, MarketType, MatchStatus, Score, Selection, Source
)

logger = logging.getLogger(__name__)

SABA_BASE_URL = os.getenv("SABA_BASE_URL", "https://f9e7oo.lcypyold.com")
SABA_ORIGIN = os.getenv("SABA_ORIGIN", "https://f9e7gr.lcypyold.com")
TOKEN_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "state", "saba_token.txt")


def _normalize_team_name(name: str) -> str:
    return name.strip().lower()


def _match_status(val: str) -> MatchStatus:
    s = val.lower()
    if s in ("l", "live"):
        return MatchStatus.LIVE
    if s in ("ns", "not_started"):
        return MatchStatus.NOT_STARTED
    return MatchStatus.UNKNOWN


def _parse_bet_type(bet_type: int) -> Optional[MarketType]:
    mapping = {1: MarketType.ASIAN_HANDICAP, 3: MarketType.OVER_UNDER, 5: MarketType.ONE_X_TWO}
    return mapping.get(bet_type)


class SABAIngestor(BaseIngestor):
    name = "saba"

    def __init__(self, poll_interval: float = 4.0):
        super().__init__(poll_interval)
        self._session: Optional[aiohttp.ClientSession] = None
        self._token: str = self._load_initial_token()
        self._is_refreshing_token = False

    def _load_initial_token(self) -> str:
        """Load token from file or env."""
        if os.path.exists(TOKEN_FILE):
            try:
                with open(TOKEN_FILE, "r") as f:
                    cached_token = f.read().strip()
                    if cached_token:
                        logger.info("[saba] Loaded token from cache: %s...", cached_token[:10])
                        return cached_token
            except Exception as e:
                logger.error("[saba] Failed to read token cache: %s", e)
        return os.getenv("SABA_TOKEN", "")

    def _save_token(self, token: str) -> None:
        """Save token to file for persistence."""
        try:
            os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
            with open(TOKEN_FILE, "w") as f:
                f.write(token)
            logger.info("[saba] Token saved to %s", TOKEN_FILE)
        except Exception as e:
            logger.error("[saba] Failed to save token cache: %s", e)

    async def _refresh_visitor_token(self) -> None:
        """Tự động mở trình duyệt ẩn để lấy Visitor Token từ localStorage"""
        if self._is_refreshing_token:
            return
        self._is_refreshing_token = True
        logger.info("[saba] Đang tự động lấy visitor token mới qua Playwright...")
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.goto(f"{SABA_ORIGIN}/vi-VN/sports/1/l", wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)
                visitor_info_str = await page.evaluate("localStorage.getItem('persist:visitorInfo')")
                if visitor_info_str:
                    visitor_info = json.loads(visitor_info_str)
                    new_token = visitor_info.get("OddsServerToken")
                    if new_token:
                        self._token = new_token
                        self._save_token(new_token)
                        logger.info("[saba] Đã lấy token tự động thành công!")
                await browser.close()
            if not self._token:
                logger.error("[saba] Không tìm thấy OddsServerToken trong localStorage.")
        except Exception as e:
            logger.error(f"[saba] Lỗi khi lấy token qua Playwright: {e}")
        finally:
            self._is_refreshing_token = False

    def reload_token(self) -> None:
        """Hot-reload token từ env (có thể gọi qua signal hoặc API)."""
        new_token = os.getenv("SABA_TOKEN", "")
        if new_token and new_token != self._token:
            self._token = new_token
            self._healthy = True
            logger.info("[saba] token reloaded")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "_mculture": "vi-VN",
            "Origin": SABA_ORIGIN,
        }

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=10)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def _show_all_odds(self, session: aiohttp.ClientSession) -> dict:
        url = f"{SABA_BASE_URL}/BFOdds/ShowAllOdds"
        data = aiohttp.FormData()
        data.add_field("GameId", "1")
        data.add_field("DateType", "l")
        data.add_field("BetTypeClass", "OU")
        data.add_field("GameType", "0")

        async with session.post(url, data=data, headers=self._headers(), ssl=False) as resp:
            self._handle_status(resp.status)
            return await resp.json(content_type=None)

    async def _get_markets(self, session: aiohttp.ClientSession, match_id: int) -> list[dict]:
        url = f"{SABA_BASE_URL}/BFOdds/GetMarkets"
        payload = [{"GameId": 1, "DateType": "l", "BetTypeClass": "OU",
                    "GameType": 0, "Matchid": match_id}]
        async with session.post(url, json=payload, headers=self._headers(), ssl=False) as resp:
            self._handle_status(resp.status)
            result = await resp.json(content_type=None)
            return result if isinstance(result, list) else []

    def _handle_status(self, status: int) -> None:
        if status == 401:
            raise AuthError(f"SABA 401 — token expired or invalid")
        if status == 429:
            raise RateLimitError(f"SABA 429 — rate limited")
        if status >= 500:
            raise ProviderError(f"SABA {status} server error")

    async def fetch_matches(self) -> list[CanonicalMatch]:
        if not self._token:
            await self._refresh_visitor_token()
            if not self._token:
                raise AuthError("SABA_TOKEN not configured and could not be fetched")

        session = await self._get_session()
        
        try:
            raw = await self._show_all_odds(session)
        except AuthError:
            logger.warning("[saba] Token expired (401), attempting to refresh...")
            await self._refresh_visitor_token()
            raw = await self._show_all_odds(session)

        if raw.get("ErrorCode") != 0:
            raise ProviderError(f"SABA API error: {raw.get('ErrorMsg')}")

        data = raw.get("Data", {})
        team_names: dict[str, str] = data.get("TeamN", {})
        league_names: dict[str, str] = data.get("LeagueN", {})
        new_matches: list[dict] = data.get("NewMatch", [])

        matches = []
        now = time.time()

        for raw_match in new_matches:
            match_id = raw_match.get("MatchId") or raw_match.get("MatchCode")
            if not match_id:
                continue

            home = team_names.get(str(raw_match.get("TeamId1", "")), "unknown")
            away = team_names.get(str(raw_match.get("TeamId2", "")), "unknown")
            league = league_names.get(str(raw_match.get("LeagueId", "")), "unknown")
            status = _match_status(raw_match.get("MaT", ""))

            score = None
            if raw_match.get("T1V") is not None and raw_match.get("T2V") is not None:
                try:
                    score = Score(int(raw_match["T1V"]), int(raw_match["T2V"]))
                except (ValueError, TypeError):
                    pass

            # Fetch market detail
            markets: list[Market] = []
            try:
                raw_markets = await self._get_markets(session, int(str(match_id)))
                for m in raw_markets:
                    mtype = _parse_bet_type(m.get("BetType", 0))
                    if not mtype:
                        continue
                    selections = []
                    p1, p2 = m.get("Price1"), m.get("Price2")
                    hdp = m.get("Hdp")
                    if mtype == MarketType.OVER_UNDER:
                        if p1:
                            selections.append(Selection("over", float(p1), float(hdp) if hdp else None))
                        if p2:
                            selections.append(Selection("under", float(p2), float(hdp) if hdp else None))
                    elif mtype == MarketType.ONE_X_TWO:
                        labels = ["home", "draw", "away"]
                        for label, price in zip(labels, [p1, m.get("Price3"), p2]):
                            if price:
                                selections.append(Selection(label, float(price)))
                    elif mtype == MarketType.ASIAN_HANDICAP:
                        if p1:
                            selections.append(Selection("home", float(p1), float(hdp) if hdp else None))
                        if p2:
                            selections.append(Selection("away", float(p2), float(hdp) if hdp else None))

                    if selections:
                        markets.append(Market(mtype, selections, Source.SABA, now, 
                                               float(hdp) if hdp else None))
            except Exception as e:
                logger.warning("[saba] failed to fetch markets for %s: %s", match_id, e)

            match_key = f"{_normalize_team_name(league)}|{_normalize_team_name(home)}|{_normalize_team_name(away)}"

            canonical = CanonicalMatch(
                match_key=match_key,
                league=league,
                home_team=home,
                away_team=away,
                status=status,
                score=score,
                minute=raw_match.get("Ktm"),
                source_markets={Source.SABA: markets},
                source_ids={Source.SABA: str(match_id)},
                ingested_at=now,
            )
            matches.append(canonical)

        return matches

    async def health_check(self) -> bool:
        try:
            session = await self._get_session()
            url = f"{SABA_BASE_URL}/BFOdds/ShowAllOdds"
            data = aiohttp.FormData()
            data.add_field("GameId", "1")
            data.add_field("DateType", "l")
            data.add_field("BetTypeClass", "OU")
            data.add_field("GameType", "0")
            async with session.post(url, data=data, headers=self._headers(), ssl=False) as resp:
                return resp.status < 500
        except Exception:
            return False

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

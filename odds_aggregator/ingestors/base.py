"""
Provider interface thống nhất (Step 2).
Mỗi ingestor (SABA, 1xBET) phải implement abstract class này.
"""
from __future__ import annotations

import abc
import asyncio
import logging
import random
from typing import AsyncIterator

from normalizer.schema import CanonicalMatch

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    pass


class AuthError(ProviderError):
    """Token hết hạn hoặc không hợp lệ."""
    pass


class RateLimitError(ProviderError):
    """Quá tần suất cho phép."""
    pass


class BaseIngestor(abc.ABC):
    """
    Interface chung cho tất cả ingestors.
    Mỗi ingestor chạy trong coroutine riêng, yield CanonicalMatch liên tục.
    """

    name: str = "base"

    def __init__(self, poll_interval: float = 5.0):
        self.poll_interval = poll_interval
        self._healthy = True
        self._error_count = 0
        self._last_error: str | None = None

    @abc.abstractmethod
    async def fetch_matches(self) -> list[CanonicalMatch]:
        """Fetch một lần và trả về list matches đã chuẩn hóa."""
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        """Kiểm tra provider còn hoạt động không."""
        ...

    async def close(self) -> None:
        """Đóng các session nội bộ."""
        pass

    async def run(self, output_queue: asyncio.Queue) -> None:
        """
        Polling loop chính. Đặt mỗi CanonicalMatch vào output_queue.
        Tự động retry với exponential backoff + jitter khi lỗi.
        """
        backoff = self.poll_interval
        max_backoff = 60.0

        while True:
            try:
                matches = await self.fetch_matches()
                self._healthy = True
                self._error_count = 0
                backoff = self.poll_interval

                for match in matches:
                    await output_queue.put(match)

                logger.info("[%s] fetched %d matches", self.name, len(matches))
                await asyncio.sleep(self.poll_interval)

            except AuthError as e:
                self._healthy = False
                self._last_error = str(e)
                logger.error("[%s] AUTH ERROR — polling halted: %s", self.name, e)
                # Không retry tự động, cần user cập nhật token → alert và chờ
                await asyncio.sleep(30)

            except RateLimitError as e:
                self._error_count += 1
                backoff = min(backoff * 2 + random.uniform(0, 2), max_backoff)
                logger.warning("[%s] RATE LIMIT — backoff %.1fs: %s", self.name, backoff, e)
                await asyncio.sleep(backoff)

            except ProviderError as e:
                self._error_count += 1
                backoff = min(backoff * 1.5 + random.uniform(0, 1), max_backoff)
                logger.warning("[%s] provider error #%d — backoff %.1fs: %s",
                               self.name, self._error_count, backoff, e)
                await asyncio.sleep(backoff)

            except Exception as e:
                self._error_count += 1
                logger.exception("[%s] unexpected error: %s", self.name, e)
                await asyncio.sleep(backoff)

    def get_health(self) -> dict:
        return {
            "name": self.name,
            "healthy": self._healthy,
            "error_count": self._error_count,
            "last_error": self._last_error,
            "poll_interval": self.poll_interval,
        }

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable, Mapping

from ..ist import available_after
from .parsers import ArchiveFormatError, parse_fo_bhavcopy_zip
from .rows import FoRow

HEADERS = {"Accept": "application/zip,*/*", "Referer": "https://www.nseindia.com/", "User-Agent": "Mozilla/5.0 (compatible; FNOEnginePhase1/1.0)"}
FO_URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{stamp}_F_0000.csv.zip"
TRANSIENT = {429, 502, 503, 504}


class ArchiveError(RuntimeError):
    pass


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: bytes


Transport = Callable[[str, Mapping[str, str]], HttpResult]


def urllib_transport(url: str, headers: Mapping[str, str]) -> HttpResult:
    request = urllib.request.Request(url, headers=dict(headers))
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return HttpResult(response.status, response.read())
    except urllib.error.HTTPError as error:
        return HttpResult(error.code, b"")


@dataclass(frozen=True)
class FetchedReport:
    effective_date: date
    rows: list[FoRow]
    sha256: str
    size_bytes: int
    retrieved_at: datetime
    available_at: datetime
    source_url: str
    from_cache: bool


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class NseArchiveClient:
    def __init__(self, cache_dir: Path, transport: Transport = urllib_transport, sleep: Callable[[float], None] = time.sleep, clock: Callable[[], datetime] = _utc_now):
        self.cache_dir = Path(cache_dir)
        self.transport = transport
        self.sleep = sleep
        self.clock = clock

    @staticmethod
    def fo_url(day: date) -> str:
        return FO_URL.format(stamp=day.strftime("%Y%m%d"))

    def _paths(self, day: date) -> tuple[Path, Path]:
        stamp = day.strftime("%Y%m%d")
        return self.cache_dir / "fo" / f"{stamp}.zip", self.cache_dir / "fo" / f"{stamp}.json"

    def _download(self, url: str) -> HttpResult:
        result = self.transport(url, HEADERS)
        for attempt in range(1, 3):
            if result.status not in TRANSIENT:
                return result
            self.sleep(0.25 * attempt)
            result = self.transport(url, HEADERS)
        return result

    def fetch_fo(self, day: date, refresh: bool = False) -> FetchedReport | None:
        if day.weekday() >= 5:
            return None
        zip_path, meta_path = self._paths(day)
        url = self.fo_url(day)
        if not refresh and zip_path.exists() and meta_path.exists():
            cached = self._read_cache(day, zip_path, meta_path, url)
            if cached is not None:
                return cached
        result = self._download(url)
        if result.status == 404:
            return None
        if result.status != 200:
            raise ArchiveError(f"NSE F&O archive returned HTTP {result.status} for {day.isoformat()}.")
        retrieved_at = self.clock()
        report = self._report(day, result.body, retrieved_at, url, False)  # parse first: a corrupt file is never cached
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        zip_path.write_bytes(result.body)
        meta_path.write_text(json.dumps({"retrieved_at": retrieved_at.isoformat(), "sha256": report.sha256, "source_url": url}), encoding="utf-8")
        return report

    def _read_cache(self, day: date, zip_path: Path, meta_path: Path, url: str) -> FetchedReport | None:
        """The cached report, or None when the cache is unreadable or fails its sha256 check (treated as corrupt: re-download)."""
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            body = zip_path.read_bytes()
            if hashlib.sha256(body).hexdigest() != meta["sha256"]:
                return None
            return self._report(day, body, datetime.fromisoformat(meta["retrieved_at"]), url, True)
        except (OSError, ValueError, KeyError, ArchiveFormatError):
            return None

    def _report(self, day: date, body: bytes, retrieved_at: datetime, url: str, from_cache: bool) -> FetchedReport:
        return FetchedReport(effective_date=day, rows=parse_fo_bhavcopy_zip(body), sha256=hashlib.sha256(body).hexdigest(), size_bytes=len(body),
                             retrieved_at=retrieved_at, available_at=available_after(day), source_url=url, from_cache=from_cache)

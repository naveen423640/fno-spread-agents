from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Mapping

EXPIRING_WINDOW = timedelta(minutes=30)
DEFAULT_MAX_AGE_HOURS = 8.0  # conservative assumption until the Phase 0 FYERS audit records the real lifetime


class TokenStatus(Enum):
    OK = "OK"
    EXPIRING = "EXPIRING"
    EXPIRED = "EXPIRED"
    MISSING = "MISSING"
    REJECTED = "REJECTED"


class TokenPathInsideRepo(RuntimeError):
    pass


@dataclass(frozen=True)
class TokenRecord:
    client_id: str
    access_token: str
    obtained_at: datetime
    expires_at: datetime
    rejected_at: datetime | None = None

    def __repr__(self) -> str:  # never print the token
        return f"TokenRecord(client_id={self.client_id!r}, access_token='***', expires_at={self.expires_at.isoformat()})"


def token_path_from_env(env: Mapping[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("FNO_ENGINE_TOKEN_FILE") or Path.home() / ".fno-engine" / "fyers_token.json")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TokenStore:
    def __init__(self, path: Path | str, repo_root: Path | None = None):
        self.path = Path(path).resolve()
        root = (repo_root or Path(__file__).resolve().parents[4]).resolve()
        if self.path == root or root in self.path.parents:
            raise TokenPathInsideRepo(f"The token file must live outside the repository ({root}).")

    def load(self) -> TokenRecord | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return TokenRecord(data["client_id"], data["access_token"], datetime.fromisoformat(data["obtained_at"]), datetime.fromisoformat(data["expires_at"]),
                               datetime.fromisoformat(data["rejected_at"]) if data.get("rejected_at") else None)
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _write(self, record: TokenRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"client_id": record.client_id, "access_token": record.access_token, "obtained_at": record.obtained_at.isoformat(),
                   "expires_at": record.expires_at.isoformat(), "rejected_at": record.rejected_at.isoformat() if record.rejected_at else None}
        self.path.write_text(json.dumps(payload), encoding="utf-8")
        try:
            os.chmod(self.path, 0o600)  # effective on POSIX; Windows ACLs are not enforced here (documented limitation)
        except OSError:
            pass

    def save(self, client_id: str, access_token: str, obtained_at: datetime, max_age_hours: float = DEFAULT_MAX_AGE_HOURS) -> TokenRecord:
        record = TokenRecord(client_id, access_token, obtained_at, obtained_at + timedelta(hours=max_age_hours))
        self._write(record)
        return record

    def mark_rejected(self, now: datetime) -> None:
        record = self.load()
        if record:
            self._write(TokenRecord(record.client_id, record.access_token, record.obtained_at, record.expires_at, now))

    def status(self, now: datetime) -> TokenStatus:
        record = self.load()
        if record is None:
            return TokenStatus.MISSING
        if record.rejected_at is not None and record.rejected_at >= record.obtained_at:
            return TokenStatus.REJECTED
        if now >= record.expires_at:
            return TokenStatus.EXPIRED
        return TokenStatus.EXPIRING if record.expires_at - now <= EXPIRING_WINDOW else TokenStatus.OK

    def expiry_note(self, now: datetime) -> str | None:
        record = self.load()
        return None if record is None else f"expires {record.expires_at.isoformat()}"

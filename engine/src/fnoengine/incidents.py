from __future__ import annotations

from datetime import datetime

from .ist import to_utc_naive
from .store.store import Store


class IncidentLog:
    def __init__(self, store: Store):
        self.conn = store.conn

    def record_once(self, kind: str, message: str, now: datetime) -> bool:
        if self.conn.execute("SELECT 1 FROM incidents WHERE kind=? AND resolved_ts IS NULL", [kind]).fetchone():
            return False
        next_id = self.conn.execute("SELECT coalesce(max(id), 0) + 1 FROM incidents").fetchone()[0]
        self.conn.execute("INSERT INTO incidents VALUES (?, ?, ?, ?, NULL)", [next_id, kind, message, to_utc_naive(now)])
        return True

    def resolve(self, kind: str, now: datetime) -> bool:
        if not self.conn.execute("SELECT 1 FROM incidents WHERE kind=? AND resolved_ts IS NULL", [kind]).fetchone():
            return False
        self.conn.execute("UPDATE incidents SET resolved_ts=? WHERE kind=? AND resolved_ts IS NULL", [to_utc_naive(now), kind])
        return True

    def _rows(self, where: str) -> list[dict]:
        cursor = self.conn.execute(f"SELECT id, kind, message, opened_ts, resolved_ts FROM incidents {where} ORDER BY id")
        return [dict(zip(["id", "kind", "message", "opened_ts", "resolved_ts"], row)) for row in cursor.fetchall()]

    def open_incidents(self) -> list[dict]:
        return self._rows("WHERE resolved_ts IS NULL")

    def all(self) -> list[dict]:
        return self._rows("")

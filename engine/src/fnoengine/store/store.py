from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from pathlib import Path

import duckdb
import pyarrow as pa

from ..ist import to_utc_naive
from ..nse.rows import FoRow
from .schema import STATEMENTS

FO_COLUMNS = ["row_number", "trading_date", "instrument_type", "ticker", "expiry_date", "strike", "option_type", "instrument_name", "open", "high",
              "low", "close", "previous_close", "underlying_price", "settle_price", "traded_volume", "traded_value", "lot_size", "open_interest", "change_in_open_interest"]


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(self.path)
        for statement in STATEMENTS:
            self.conn.execute(statement)

    def close(self) -> None:
        self.conn.close()

    def insert_fo(self, effective: date, rows: list[FoRow], *, sha256: str, size_bytes: int, retrieval_ts: datetime, available_ts: datetime) -> str:
        current = self.conn.execute("SELECT sha256 FROM ingest_files WHERE kind='fo' AND effective_date=? AND is_current", [effective]).fetchone()
        if current and current[0] == sha256:
            return "unchanged"
        outcome = "revised" if current else "inserted"
        self.conn.execute("BEGIN")
        try:
            retrieval, available = to_utc_naive(retrieval_ts), to_utc_naive(available_ts)
            revision = 0
            if current:
                # Superseded rows are kept. A revision cannot be visible before we first saw it.
                available = max(available, retrieval)
                revision = self.conn.execute("SELECT max(revision) FROM fo_daily WHERE effective_date=?", [effective]).fetchone()[0] + 1
                self.conn.execute("UPDATE ingest_files SET is_current=false WHERE kind='fo' AND effective_date=?", [effective])
            columns = {name: [getattr(row, name) for row in rows] for name in FO_COLUMNS if name != "row_number"}
            table = pa.table({
                "effective_date": pa.array([effective] * len(rows), pa.date32()),
                "available_ts": pa.array([available] * len(rows), pa.timestamp("us")),
                "retrieval_ts": pa.array([retrieval] * len(rows), pa.timestamp("us")),
                "source_sha256": pa.array([sha256] * len(rows), pa.string()),
                "revision": pa.array([revision] * len(rows), pa.int32()),
                "row_number": pa.array(list(range(len(rows))), pa.int32()),
                **{name: values for name, values in columns.items()},
            })
            self.conn.register("batch", table)
            self.conn.execute("INSERT INTO fo_daily SELECT * FROM batch")
            self.conn.unregister("batch")
            self.conn.execute("INSERT INTO ingest_files VALUES ('fo', ?, ?, ?, ?, ?, true)", [effective, sha256, size_bytes, retrieval, available])
            self.conn.execute("COMMIT")
        except Exception:
            self.conn.execute("ROLLBACK")
            raise
        return outcome

    def fo_dates(self) -> list[date]:
        """Stored dates regardless of availability. Never use for decisions; point-in-time code uses PointInTimeReader."""
        return [r[0] for r in self.conn.execute("SELECT DISTINCT effective_date FROM fo_daily ORDER BY 1").fetchall()]

    def _content_hash(self) -> tuple[str, dict]:
        files = self.conn.execute("SELECT kind, effective_date, sha256 FROM ingest_files WHERE is_current ORDER BY kind, effective_date").fetchall()
        digest = hashlib.sha256("\n".join(f"{k}:{d.isoformat()}:{s}" for k, d, s in files).encode()).hexdigest()
        return digest, {"files": len(files)}

    def record_version(self, label: str, now: datetime) -> str:
        digest, counts = self._content_hash()
        count = self.conn.execute("SELECT count(*) FROM dataset_versions").fetchone()[0]
        version_id = f"v{count + 1:04d}-{digest[:12]}"
        self.conn.execute("INSERT INTO dataset_versions VALUES (?, ?, ?, ?, ?)", [version_id, to_utc_naive(now), label, digest, json.dumps(counts)])
        return digest

    def versions(self) -> list[dict]:
        cursor = self.conn.execute("SELECT version_id, created_ts, label, content_hash FROM dataset_versions ORDER BY version_id")
        return [dict(zip(["version_id", "created_ts", "label", "content_hash"], row)) for row in cursor.fetchall()]

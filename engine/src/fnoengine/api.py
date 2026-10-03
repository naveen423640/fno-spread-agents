from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Callable

from fastapi import FastAPI, HTTPException

from .auth.token_store import TokenStore
from .gates import entry_gate
from .incidents import IncidentLog
from .store.reader import PointInTimeReader
from .store.store import Store
from .universe import fno_universe_on


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(store: Store, tokens: TokenStore, now: Callable[[], datetime] = _utc_now) -> FastAPI:
    app = FastAPI(title="fno-engine (read-only)", docs_url=None, redoc_url=None)
    reader = PointInTimeReader(store)

    def universe_for(day: date):
        rows = reader.fo_rows(day, now())
        if rows is None:
            raise HTTPException(404, f"No published F&O data for {day.isoformat()}.")
        return {"date": day.isoformat(), "source": "engine", "availableAsOf": now().isoformat(),
                "entries": [{"ticker": e.ticker, "lotSize": e.lot_size} for e in fno_universe_on(rows)]}

    @app.get("/health")
    def health():
        return {"status": "ok", "time": now().isoformat()}

    @app.get("/token/status")
    def token_status():
        status = tokens.status(now())
        decision = entry_gate(status)
        return {"status": status.value, "allowEntries": decision.allow_entries, "reason": decision.reason, "note": tokens.expiry_note(now())}

    @app.get("/incidents")
    def incidents():
        log = IncidentLog(store)
        return {"open": [_json(i) for i in log.open_incidents()], "all": [_json(i) for i in log.all()]}

    @app.get("/universe/latest")
    def universe_latest():
        latest = reader.latest_available_date(now())
        if latest is None:
            raise HTTPException(404, "No published F&O data is stored yet.")
        return universe_for(latest)

    @app.get("/universe/{day}")
    def universe_on(day: str):
        try:
            parsed = date.fromisoformat(day)
        except ValueError as error:
            raise HTTPException(400, "day must be YYYY-MM-DD or 'latest'.") from error
        return universe_for(parsed)

    return app


def _json(row: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in row.items()}


def serve() -> None:
    import uvicorn

    from .auth.token_store import token_path_from_env
    from .safety import assert_paper_only

    assert_paper_only()
    from pathlib import Path

    data_dir = Path(__file__).resolve().parents[2] / "data"
    uvicorn.run(create_app(Store(data_dir / "fno.duckdb"), TokenStore(token_path_from_env())), host="127.0.0.1", port=8765)


if __name__ == "__main__":
    serve()

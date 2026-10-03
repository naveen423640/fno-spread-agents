from datetime import datetime, timedelta, timezone
from pathlib import Path

from fnoengine.auth.token_store import TokenStatus, TokenStore
from fnoengine.gates import TokenMonitor, entry_gate
from fnoengine.incidents import IncidentLog
from fnoengine.store.store import Store

REPO = Path(__file__).resolve().parents[2]
T0 = datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)


def test_gate_blocks_missing_expired_and_rejected_and_allows_the_rest():
    for status in (TokenStatus.MISSING, TokenStatus.EXPIRED, TokenStatus.REJECTED):
        decision = entry_gate(status)
        assert decision.allow_entries is False and decision.reason
    assert entry_gate(TokenStatus.OK).allow_entries is True
    assert entry_gate(TokenStatus.EXPIRING).allow_entries is True


def test_monitor_blocks_records_one_incident_and_resolves_on_a_new_token(tmp_path):
    tokens = TokenStore(tmp_path / "t.json", repo_root=REPO)
    incidents = IncidentLog(Store(tmp_path / "s.duckdb"))
    monitor = TokenMonitor(tokens, incidents)
    for minute in range(3):  # repeated checks while the token is missing
        assert monitor.check(T0 + timedelta(minutes=minute)).allow_entries is False
    assert [i["kind"] for i in incidents.open_incidents()] == ["FYERS_TOKEN_UNAVAILABLE"]
    assert len(incidents.all()) == 1  # recorded once, not once per check
    tokens.save("CLIENT", "tok", T0 + timedelta(minutes=5))
    assert monitor.check(T0 + timedelta(minutes=6)).allow_entries is True
    assert incidents.open_incidents() == []


def test_monitor_blocks_again_when_the_token_expires(tmp_path):
    tokens = TokenStore(tmp_path / "t.json", repo_root=REPO)
    incidents = IncidentLog(Store(tmp_path / "s.duckdb"))
    monitor = TokenMonitor(tokens, incidents)
    tokens.save("CLIENT", "tok", T0, max_age_hours=1)
    assert monitor.check(T0 + timedelta(minutes=10)).allow_entries is True
    assert monitor.check(T0 + timedelta(hours=2)).allow_entries is False
    assert len(incidents.open_incidents()) == 1

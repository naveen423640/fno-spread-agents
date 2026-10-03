import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fnoengine.auth.token_store import TokenPathInsideRepo, TokenStatus, TokenStore

REPO = Path(__file__).resolve().parents[2]
T0 = datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)


def store(tmp_path):
    return TokenStore(tmp_path / "t.json", repo_root=REPO)


def test_missing_file_is_missing(tmp_path):
    assert store(tmp_path).status(T0) is TokenStatus.MISSING


def test_fresh_token_is_ok_then_expiring_then_expired(tmp_path):
    s = store(tmp_path)
    s.save("CLIENT", "SECRET-TOKEN", T0, max_age_hours=8)
    assert s.status(T0 + timedelta(hours=1)) is TokenStatus.OK
    assert s.status(T0 + timedelta(hours=7, minutes=45)) is TokenStatus.EXPIRING
    assert s.status(T0 + timedelta(hours=8)) is TokenStatus.EXPIRED


def test_rejection_by_the_api_overrides_the_clock_until_a_new_token_is_saved(tmp_path):
    s = store(tmp_path)
    s.save("CLIENT", "tok", T0)
    s.mark_rejected(T0 + timedelta(hours=1))
    assert s.status(T0 + timedelta(hours=1, minutes=1)) is TokenStatus.REJECTED
    s.save("CLIENT", "tok2", T0 + timedelta(hours=2))
    assert s.status(T0 + timedelta(hours=2, minutes=1)) is TokenStatus.OK


def test_a_corrupt_file_counts_as_missing_not_a_crash(tmp_path):
    path = tmp_path / "t.json"
    path.write_text("{not json")
    assert TokenStore(path, repo_root=REPO).status(T0) is TokenStatus.MISSING


def test_a_path_inside_the_repository_is_refused(tmp_path):
    with pytest.raises(TokenPathInsideRepo):
        TokenStore(REPO / "engine" / "data" / "token.json", repo_root=REPO)


def test_status_and_notes_never_contain_the_token(tmp_path):
    s = store(tmp_path)
    s.save("CLIENT", "SECRET-TOKEN", T0)
    assert "SECRET-TOKEN" not in repr(s.status(T0)) and "SECRET-TOKEN" not in (s.expiry_note(T0) or "")
    assert "SECRET-TOKEN" not in repr(s.load())  # repr of the record is masked
    assert json.loads((tmp_path / "t.json").read_text())["access_token"] == "SECRET-TOKEN"  # stored on disk only


def test_default_repo_root_is_the_repository_root():
    import fnoengine.auth.token_store as module

    assert (Path(module.__file__).resolve().parents[4] / "engine" / "src" / "fnoengine").is_dir()
    with pytest.raises(TokenPathInsideRepo):
        TokenStore(REPO / "engine" / "data" / "token.json")  # default root, no override

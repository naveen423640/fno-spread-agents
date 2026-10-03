import hashlib
import json

import pytest

from fnoengine.auth.login import LoginError, exchange_auth_code
from fnoengine.nse.archive import HttpResult


def test_posts_the_hash_and_code_and_returns_the_token_without_exposing_the_secret():
    seen = {}

    def transport(url, headers, body):
        seen.update(url=url, body=json.loads(body))
        return HttpResult(200, json.dumps({"s": "ok", "access_token": "TOK"}).encode())

    assert exchange_auth_code("APP-100", "SECRET", "CODE", transport) == "TOK"
    assert seen["url"].endswith("/api/v3/validate-authcode")
    assert seen["body"] == {"grant_type": "authorization_code", "appIdHash": hashlib.sha256(b"APP-100:SECRET").hexdigest(), "code": "CODE"}
    assert "SECRET" not in json.dumps(seen["body"])


def test_failures_raise_a_login_error_with_the_provider_message_only():
    def transport(url, headers, body):
        return HttpResult(400, json.dumps({"s": "error", "message": "invalid code"}).encode())

    with pytest.raises(LoginError, match="invalid code"):
        exchange_auth_code("A", "S", "C", transport)

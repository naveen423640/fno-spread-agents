from __future__ import annotations

import getpass
import hashlib
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Callable, Mapping

from ..nse.archive import HttpResult
from ..safety import assert_paper_only
from . import fyers_endpoints
from .token_store import TokenStore, token_path_from_env

Transport = Callable[[str, Mapping[str, str], bytes], HttpResult]


class LoginError(RuntimeError):
    pass


def _post(url: str, headers: Mapping[str, str], body: bytes) -> HttpResult:
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return HttpResult(response.status, response.read())
    except urllib.error.HTTPError as error:
        return HttpResult(error.code, error.read() or b"")


def exchange_auth_code(client_id: str, secret_key: str, auth_code: str, transport: Transport = _post) -> str:
    app_id_hash = hashlib.sha256(f"{client_id}:{secret_key}".encode()).hexdigest()
    body = json.dumps({"grant_type": "authorization_code", "appIdHash": app_id_hash, "code": auth_code}).encode()
    result = transport(fyers_endpoints.VALIDATE_AUTHCODE, {"Content-Type": "application/json", "Accept": "application/json"}, body)
    try:
        payload = json.loads(result.body or b"{}")
    except ValueError:
        payload = {}
    if result.status != 200 or payload.get("s") != "ok" or not payload.get("access_token"):
        raise LoginError(payload.get("message") or f"FYERS token exchange failed (HTTP {result.status}).")
    return payload["access_token"]


def main() -> None:
    """Manual, user-run login. Reads FYERS_CLIENT_ID / FYERS_SECRET_KEY / FYERS_REDIRECT_URI from the environment; never prints the token."""
    assert_paper_only()
    client_id, secret, redirect = (os.environ.get(k) for k in ("FYERS_CLIENT_ID", "FYERS_SECRET_KEY", "FYERS_REDIRECT_URI"))
    if not (client_id and secret and redirect):
        raise SystemExit("Set FYERS_CLIENT_ID, FYERS_SECRET_KEY and FYERS_REDIRECT_URI in this shell first.")
    print(f"Open this URL, log in, then paste the auth_code from the address you are redirected to:\n{fyers_endpoints.GENERATE_AUTHCODE}?client_id={client_id}&redirect_uri={redirect}&response_type=code&state=engine")
    code = getpass.getpass("auth_code (hidden): ").strip()
    token = exchange_auth_code(client_id, secret, code)
    TokenStore(token_path_from_env()).save(client_id, token, datetime.now(timezone.utc), float(os.environ.get("FNO_TOKEN_MAX_AGE_HOURS", "8")))
    print("Token saved. It is stored outside the repository and was not printed.")


if __name__ == "__main__":
    main()

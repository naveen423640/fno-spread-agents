from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .auth.token_store import TokenStatus, TokenStore
from .incidents import IncidentLog

KIND = "FYERS_TOKEN_UNAVAILABLE"


@dataclass(frozen=True)
class GateDecision:
    allow_entries: bool
    reason: str | None


def entry_gate(status: TokenStatus) -> GateDecision:
    if status in (TokenStatus.MISSING, TokenStatus.EXPIRED, TokenStatus.REJECTED):
        return GateDecision(False, f"FYERS token {status.value.lower()}: new entries are blocked until a fresh login.")
    return GateDecision(True, "FYERS token expiring soon." if status is TokenStatus.EXPIRING else None)


class TokenMonitor:
    def __init__(self, tokens: TokenStore, incidents: IncidentLog):
        self.tokens, self.incidents = tokens, incidents

    def check(self, now: datetime) -> GateDecision:
        status = self.tokens.status(now)
        decision = entry_gate(status)
        if decision.allow_entries:
            self.incidents.resolve(KIND, now)
        else:
            self.incidents.record_once(KIND, decision.reason or status.value, now)
        return decision

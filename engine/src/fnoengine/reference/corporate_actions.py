from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date

SUPPORTED = {"SPLIT", "BONUS", "OTHER"}


@dataclass(frozen=True)
class CorporateAction:
    ticker: str
    ex_date: date
    action_type: str
    a: float
    b: float
    source: str
    verified: bool


@dataclass(frozen=True)
class AdjustmentResult:
    factor: float
    unverified_count: int


def load_corporate_actions_csv(text: str) -> list[CorporateAction]:
    actions = []
    for number, row in enumerate(csv.DictReader(io.StringIO(text)), start=2):
        try:
            ex_date = date.fromisoformat(row["ex_date"].strip())
        except ValueError as error:
            raise ValueError(f"line {number}: invalid ex_date {row['ex_date']!r}") from error
        action_type = row["action_type"].strip().upper()
        if action_type not in SUPPORTED:
            raise ValueError(f"line {number}: unsupported action_type {action_type!r}")
        actions.append(CorporateAction(row["ticker"].strip().upper(), ex_date, action_type, float(row["a"] or 0), float(row["b"] or 0),
                                       row.get("source", "").strip(), row["verified"].strip().lower() == "true"))
    return actions


def adjustment_factor(actions: list[CorporateAction], ticker: str, session: date) -> AdjustmentResult:
    """Multiply a close of `session` by `factor` to express it in today's terms.

    A session's close is converted to today's terms by multiplying with the factor
    of every action whose `ex_date` is AFTER that session.

    For SPLIT: `a` is old face value, `b` is new; price factor = `b/a`
    For BONUS: `a` is shares held, `b` is bonus shares; price factor = `a/(a+b)`
    For OTHER: no price adjustment
    """
    factor, unverified = 1.0, 0
    for action in actions:
        if action.ticker != ticker.upper() or action.ex_date <= session or action.action_type == "OTHER":
            continue
        factor *= (action.b / action.a) if action.action_type == "SPLIT" else (action.a / (action.a + action.b))
        unverified += 0 if action.verified else 1
    return AdjustmentResult(factor, unverified)

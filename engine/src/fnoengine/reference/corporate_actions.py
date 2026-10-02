from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass
from datetime import date

SUPPORTED = {"SPLIT", "BONUS", "OTHER"}
REQUIRED_HEADERS = {"ticker", "ex_date", "action_type", "a", "b", "source", "verified"}


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
    """Load corporate actions from CSV.

    Requires all headers: ticker, ex_date, action_type, a, b, source, verified.
    For SPLIT and BONUS: requires a > 0, b > 0, and both finite.
    OTHER type may have a=0, b=0.
    Raises ValueError with physical line number for any validation error.
    """
    # Strip UTF-8 BOM if present
    if text.startswith('﻿'):
        text = text[1:]

    lines = text.split('\n')
    reader = csv.DictReader(io.StringIO(text))

    # Validate headers before reading rows
    if reader.fieldnames is None:
        raise ValueError("empty CSV or no header row")

    missing = REQUIRED_HEADERS - set(reader.fieldnames)
    if missing:
        raise ValueError(f"missing required columns: {', '.join(sorted(missing))}")

    actions = []
    for row in reader:
        line_num = reader.line_num

        try:
            # Validate all fields are present (short rows give None)
            if row.get("ticker") is None or row.get("verified") is None:
                raise ValueError(f"line {line_num}: incomplete row (missing fields)")

            ticker = row["ticker"].strip().upper()
            try:
                ex_date = date.fromisoformat(row["ex_date"].strip())
            except ValueError as e:
                raise ValueError(f"line {line_num}: invalid ex_date {row['ex_date']!r}") from e
            action_type = row["action_type"].strip().upper()

            if action_type not in SUPPORTED:
                raise ValueError(f"line {line_num}: unsupported action_type {action_type!r}")

            # Parse a and b
            try:
                a_str = row["a"].strip()
                a = float(a_str) if a_str else None
            except ValueError:
                raise ValueError(f"line {line_num}: invalid value for a {row['a']!r}")

            try:
                b_str = row["b"].strip()
                b = float(b_str) if b_str else None
            except ValueError:
                raise ValueError(f"line {line_num}: invalid value for b {row['b']!r}")

            # Validate numeric values
            if action_type in ("SPLIT", "BONUS"):
                if a is None or a <= 0:
                    raise ValueError(f"line {line_num}: {action_type} requires a > 0, got {a}")
                if b is None or b <= 0:
                    raise ValueError(f"line {line_num}: {action_type} requires b > 0, got {b}")
                if not math.isfinite(a) or not math.isfinite(b):
                    raise ValueError(f"line {line_num}: {action_type} requires a and b to be finite")
                if action_type == "BONUS" and a + b <= 0:
                    raise ValueError(f"line {line_num}: BONUS requires a + b > 0")

            verified = row["verified"].strip().lower() == "true"

            actions.append(CorporateAction(ticker, ex_date, action_type, a or 0.0, b or 0.0,
                                          row.get("source", "").strip(), verified))

        except ValueError:
            raise
        except (KeyError, TypeError, AttributeError) as e:
            raise ValueError(f"line {line_num}: {type(e).__name__}: {e}") from e

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

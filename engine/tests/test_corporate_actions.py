from datetime import date

import pytest

from fnoengine.reference.corporate_actions import CorporateAction, adjustment_factor, load_corporate_actions_csv

CSV = """ticker,ex_date,action_type,a,b,source,verified
XYZ,2026-06-10,SPLIT,10,5,NSE announcement,true
XYZ,2026-08-01,BONUS,1,1,NSE announcement,false
ABC,2026-07-01,OTHER,0,0,manual,true
"""


def test_loads_rows_and_the_verified_flag():
    actions = load_corporate_actions_csv(CSV)
    assert [(a.ticker, a.action_type, a.verified) for a in actions] == [("XYZ", "SPLIT", True), ("XYZ", "BONUS", False), ("ABC", "OTHER", True)]


def test_split_and_bonus_factors_apply_to_sessions_before_the_ex_date():
    actions = load_corporate_actions_csv(CSV)
    result = adjustment_factor(actions, "XYZ", date(2026, 5, 1))  # before both
    assert result.factor == pytest.approx(0.5 * 0.5) and result.unverified_count == 1
    assert adjustment_factor(actions, "XYZ", date(2026, 7, 1)).factor == pytest.approx(0.5)  # after the split, before the bonus
    assert adjustment_factor(actions, "XYZ", date(2026, 9, 1)).factor == 1.0


def test_the_ex_date_session_itself_is_already_adjusted():
    actions = load_corporate_actions_csv(CSV)
    assert adjustment_factor(actions, "XYZ", date(2026, 6, 10)).factor == pytest.approx(0.5)  # split not applied, bonus (Aug) is


def test_other_tickers_and_unsupported_types_do_not_change_prices():
    actions = load_corporate_actions_csv(CSV)
    assert adjustment_factor(actions, "ABC", date(2026, 1, 1)).factor == 1.0
    assert adjustment_factor(actions, "NONE", date(2026, 1, 1)).factor == 1.0


def test_a_bad_row_fails_loudly():
    with pytest.raises(ValueError, match="ex_date"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,not-a-date,SPLIT,10,5,x,true\n")
    with pytest.raises(ValueError, match="action_type"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,MERGER,1,1,x,true\n")

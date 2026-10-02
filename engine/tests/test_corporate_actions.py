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
    with pytest.raises(ValueError, match=r"line 2.*invalid ex_date"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,not-a-date,SPLIT,10,5,x,true\n")
    with pytest.raises(ValueError, match="action_type"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,MERGER,1,1,x,true\n")


def test_validates_required_headers():
    with pytest.raises(ValueError, match="verified"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source\nXYZ,2026-01-01,SPLIT,10,5,NSE\n")
    with pytest.raises(ValueError, match="ticker"):
        load_corporate_actions_csv("ex_date,action_type,a,b,source,verified\n2026-01-01,SPLIT,10,5,NSE,true\n")


def test_non_numeric_a_b_fails_with_line_number():
    with pytest.raises(ValueError, match=r"line 2.*\ba\b"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,abc,5,NSE,true\n")
    with pytest.raises(ValueError, match=r"line 2.*\bb\b"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,10,xyz,NSE,true\n")


def test_short_row_fails_with_line_number():
    with pytest.raises(ValueError, match=r"line 2"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,10\n")


def test_split_with_zero_a_rejected_at_load_time():
    with pytest.raises(ValueError, match=r"line 2.*a.*>.*0"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,0,5,NSE,true\n")


def test_split_with_empty_a_b_rejected_at_load_time():
    with pytest.raises(ValueError, match=r"line 2.*a.*>.*0"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,,5,NSE,true\n")


def test_negative_a_b_rejected():
    with pytest.raises(ValueError, match=r"line 2.*a.*>.*0"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,-1,5,NSE,true\n")
    with pytest.raises(ValueError, match=r"line 2.*b.*>.*0"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,10,-2,NSE,true\n")


def test_nan_inf_rejected():
    with pytest.raises(ValueError, match=r"line 2.*finite"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,inf,5,NSE,true\n")
    with pytest.raises(ValueError, match=r"line 2.*finite"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,BONUS,1,nan,NSE,true\n")


def test_bonus_with_zero_sum_rejected():
    with pytest.raises(ValueError, match=r"line 2"):
        load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,BONUS,0,0,NSE,true\n")


def test_other_can_have_zero_values():
    actions = load_corporate_actions_csv("ticker,ex_date,action_type,a,b,source,verified\nABC,2026-07-01,OTHER,0,0,manual,true\n")
    assert actions[0].a == 0.0 and actions[0].b == 0.0


def test_bom_prefixed_csv_loads():
    bom_csv = "﻿ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,10,5,NSE,true\n"
    actions = load_corporate_actions_csv(bom_csv)
    assert len(actions) == 1 and actions[0].ticker == "XYZ"


def test_physical_line_number_with_blank_lines():
    csv_with_blank = "ticker,ex_date,action_type,a,b,source,verified\nXYZ,2026-01-01,SPLIT,10,5,NSE,true\n\nABC,2026-02-01,SPLIT,abc,5,NSE,true\n"
    with pytest.raises(ValueError, match=r"line 4"):
        load_corporate_actions_csv(csv_with_blank)

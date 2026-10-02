from pathlib import Path

from fnoengine.reference.banlist import parse_ban_list

REAL = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "real" / "fo_secban_sample.csv"
NIL = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "real" / "fo_secban_nil_sample.csv"


def test_parses_numbered_rows_and_ignores_headings():
    text = "Securities in Ban For Trade Date 29-SEP-2026:\n1,ABC\n2,M&M\n3,BAJAJ-AUTO\n"
    assert parse_ban_list(text) == ["ABC", "M&M", "BAJAJ-AUTO"]


def test_a_day_with_no_banned_securities_is_an_empty_list():
    assert parse_ban_list("Securities in Ban For Trade Date 29-SEP-2026:\n") == []
    assert parse_ban_list("") == []


def test_handles_windows_line_endings_and_spaces():
    assert parse_ban_list("Securities in Ban For Trade Date 29-SEP-2026:\r\n1, ABC \r\n2 ,XYZ\r\n") == ["ABC", "XYZ"]


def test_real_sample_parses_without_error():
    result = parse_ban_list(REAL.read_text(encoding="utf-8"))
    assert all(t == t.upper() and " " not in t for t in result)


def test_real_sample_parses_to_exact_tickers():
    result = parse_ban_list(REAL.read_text(encoding="utf-8"))
    assert result == ["LICHSGFIN", "SAIL"]


def test_nil_sample_parses_to_empty_list():
    result = parse_ban_list(NIL.read_text(encoding="utf-8"))
    assert result == []


def test_missing_title_line_raises_error():
    import pytest
    with pytest.raises(ValueError, match="unrecognised ban-list layout"):
        parse_ban_list("1,ABC\n2,XYZ\n")


def test_html_error_page_raises_error():
    import pytest
    html_text = "<html><body>404 Not Found</body></html>"
    with pytest.raises(ValueError, match="unrecognised ban-list layout"):
        parse_ban_list(html_text)


def test_arbitrary_text_without_title_raises_error():
    import pytest
    with pytest.raises(ValueError, match="unrecognised ban-list layout"):
        parse_ban_list("Some random text\nAnother line")


def test_row_with_spaces_in_ticker_without_title_raises_error():
    import pytest
    with pytest.raises(ValueError, match="unrecognised ban-list layout"):
        parse_ban_list("1,TICKER NAME\n")


def test_empty_string_still_returns_empty_list():
    assert parse_ban_list("") == []

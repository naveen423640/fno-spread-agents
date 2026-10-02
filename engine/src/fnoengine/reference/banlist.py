from __future__ import annotations

import re

# URL from the NSE audit (docs/audit/01-nse-archives.md section 4).
# Note: the file for trade date T is published the evening before T (verified by audit).
# It must NOT use the bhavcopy `available_after` rule due to this forward-looking nature.
BAN_LIST_URL = "https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv"

_ROW = re.compile(r"^\s*\d+\s*,\s*([A-Za-z0-9&_-]+)\s*$")
_TITLE = "Securities in Ban For Trade Date"


def parse_ban_list(text: str) -> list[str]:
    """Parse NSE ban list CSV format.

    Expected layout:
    - Header line: "Securities in Ban For Trade Date DD-MMM-YYYY:" (or "... NIL")
    - Numbered rows: "1,TICKER\\n2,TICKER2\\n..." (or empty for NIL days)

    Raises ValueError if the text is non-empty and does not contain the title line.
    Returns empty list for: empty text, text with only whitespace, or title-only text.
    """
    if not text or not text.strip():
        return []

    # Check if title line is present if text is non-empty
    if _TITLE not in text:
        raise ValueError(f"unrecognised ban-list layout: title line '{_TITLE}' not found")

    # Parse numbered rows
    return [m.group(1).upper() for line in text.splitlines() if (m := _ROW.match(line))]

from __future__ import annotations

import re

# URL from the NSE audit (docs/audit/01-nse-archives.md section 4).
# Note: the file for trade date T is published the evening before T (verified by audit).
# It must NOT use the bhavcopy `available_after` rule due to this forward-looking nature.
BAN_LIST_URL = "https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv"

_ROW = re.compile(r"^\s*\d+\s*,\s*([A-Za-z0-9&_-]+)\s*$")


def parse_ban_list(text: str) -> list[str]:
    return [m.group(1).upper() for line in text.splitlines() if (m := _ROW.match(line))]

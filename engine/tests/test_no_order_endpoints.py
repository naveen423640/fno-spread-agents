import re
from pathlib import Path

ALLOWED_PATHS = {"", "/api/v3/generate-authcode", "/api/v3/validate-authcode", "/data/history", "/data/quotes", "/data/options-chain-v3"}
DENY = re.compile(r"place_?order|create_?order|cancel_?order|modify_?order|exit_?positions|multi_?order|convert_?position|\bgtt\b", re.I)
URL = re.compile(r"https?://[a-z0-9.-]*fyers\.in(/[A-Za-z0-9/_-]*)?", re.I)


def find_violations(root: Path) -> list[str]:
    out: list[str] = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for m in URL.finditer(text):
            if (m.group(1) or "") not in ALLOWED_PATHS:
                out.append(f"{path}: FYERS path {m.group(1)}")
        if DENY.search(text):
            out.append(f"{path}: order-related term")
    return out


def test_engine_source_references_no_order_endpoints():
    assert find_violations(Path(__file__).resolve().parents[1] / "src") == []


def test_scanner_catches_violations(tmp_path):
    (tmp_path / "a.py").write_text("X = 'https://api-t1.fyers.in/api/v3/orders'")
    (tmp_path / "b.py").write_text("def place_order(): pass")
    assert len(find_violations(tmp_path)) == 2

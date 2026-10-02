STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS fo_daily (
        effective_date DATE NOT NULL, available_ts TIMESTAMP NOT NULL, retrieval_ts TIMESTAMP NOT NULL, source_sha256 VARCHAR NOT NULL,
        row_number INTEGER NOT NULL, trading_date VARCHAR, instrument_type VARCHAR, ticker VARCHAR, expiry_date VARCHAR, strike DOUBLE,
        option_type VARCHAR, instrument_name VARCHAR, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, previous_close DOUBLE,
        underlying_price DOUBLE, settle_price DOUBLE, traded_volume DOUBLE, traded_value DOUBLE, lot_size INTEGER,
        open_interest DOUBLE, change_in_open_interest DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS ingest_files (
        kind VARCHAR NOT NULL, effective_date DATE NOT NULL, sha256 VARCHAR NOT NULL, size_bytes BIGINT,
        retrieval_ts TIMESTAMP NOT NULL, available_ts TIMESTAMP NOT NULL, is_current BOOLEAN NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS dataset_versions (
        version_id VARCHAR PRIMARY KEY, created_ts TIMESTAMP NOT NULL, label VARCHAR, content_hash VARCHAR NOT NULL, counts_json VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS incidents (
        id BIGINT PRIMARY KEY, kind VARCHAR NOT NULL, message VARCHAR NOT NULL, opened_ts TIMESTAMP NOT NULL, resolved_ts TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS ban_list (
        effective_date DATE NOT NULL, available_ts TIMESTAMP NOT NULL, retrieval_ts TIMESTAMP NOT NULL, ticker VARCHAR NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS corporate_actions (
        ticker VARCHAR NOT NULL, ex_date DATE NOT NULL, action_type VARCHAR NOT NULL, a DOUBLE, b DOUBLE,
        source VARCHAR, verified BOOLEAN NOT NULL, loaded_ts TIMESTAMP NOT NULL)""",
]

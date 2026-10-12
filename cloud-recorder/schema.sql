-- The one extra table of the cloud recorder: today's FYERS access token, put there by hand each morning (PUT /token). One row, never listed or exported.
CREATE TABLE IF NOT EXISTS recorder_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  client_id TEXT -- the FYERS app id the token was issued to; null means the one in the Worker's config
);

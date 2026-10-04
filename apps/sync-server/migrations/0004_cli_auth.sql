CREATE TABLE cli_device_grants (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  last_poll INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cli_device_expiry ON cli_device_grants(expires_at);
CREATE TABLE cli_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX cli_tokens_user ON cli_tokens(user_id);
CREATE TABLE cli_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);

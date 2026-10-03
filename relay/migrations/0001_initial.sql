CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  payload TEXT NOT NULL, payload_hash TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL, acknowledged_at TEXT
);
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, revision INTEGER NOT NULL,
  data_hash TEXT NOT NULL, generated_at TEXT NOT NULL, envelope TEXT NOT NULL,
  UNIQUE(ledger_id, revision)
);
CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, redirects TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_requests (id TEXT PRIMARY KEY, params TEXT NOT NULL, csrf_hash TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes (
  hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL, scope TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash TEXT PRIMARY KEY, type TEXT NOT NULL, client_id TEXT NOT NULL,
  resource TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS draft_pending ON drafts(acknowledged_at, created_at);
CREATE INDEX IF NOT EXISTS backup_latest ON backups(revision DESC);

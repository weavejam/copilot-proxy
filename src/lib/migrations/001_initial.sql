-- Initial schema for copilot-api multi-account & usage billing.
-- Owned by tasks #1 (this migration), #2 (accounts loader), #6 (usage recorder),
-- #13 (pricing version writer). See docs/design/.

CREATE TABLE IF NOT EXISTS accounts (
  name TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_pricing (
  model_id TEXT PRIMARY KEY,
  input_per_mtok REAL,
  cached_input_per_mtok REAL,
  output_per_mtok REAL,
  reasoning_per_mtok REAL,
  premium_multiplier REAL,
  premium_unit_price REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT,
  source_skus TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL,
  source_count INTEGER,
  llm_model TEXT,
  models_updated INTEGER,
  models_rejected INTEGER,
  error TEXT,
  raw_request_json TEXT,
  raw_response_json TEXT,
  diff_json TEXT
);

CREATE TABLE IF NOT EXISTS model_pricing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  input_per_mtok REAL,
  cached_input_per_mtok REAL,
  output_per_mtok REAL,
  reasoning_per_mtok REAL,
  premium_multiplier REAL,
  premium_unit_price REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT,
  source_skus TEXT,
  sync_log_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sync_log_id) REFERENCES pricing_sync_log(id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_versions_model_time
  ON model_pricing_versions(model_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_pricing_versions_current
  ON model_pricing_versions(model_id) WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  upstream_format TEXT NOT NULL,
  is_streaming INTEGER NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  cached_input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  premium_request_count REAL DEFAULT 0,
  input_price_snapshot REAL,
  cached_input_price_snapshot REAL,
  output_price_snapshot REAL,
  reasoning_price_snapshot REAL,
  premium_unit_price_snapshot REAL,
  premium_multiplier_snapshot REAL,
  request_id TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  FOREIGN KEY (account_name) REFERENCES accounts(name)
);

CREATE INDEX IF NOT EXISTS idx_usage_account_model_ts
  ON usage_events(account_name, model_id, ts);

CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  account_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  req_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  premium_requests REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account_name, model_id, endpoint)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

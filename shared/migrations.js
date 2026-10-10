// Database schema, applied in order. Never edit a released migration; add a new one.
export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE connections (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('bank', 'card')),
  provider         TEXT NOT NULL,            -- israeli-bank-scrapers company id
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ok'
                   CHECK (status IN ('ok', 'needs_attention', 'otp_required', 'error', 'syncing')),
  status_detail    TEXT,
  last_sync_at     TEXT,
  credentials      BLOB,                     -- AES-GCM blob, separate IV per record
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  connection_id    TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  display_name     TEXT NOT NULL,
  masked_number    TEXT NOT NULL,            -- last 4 digits only
  type             TEXT NOT NULL CHECK (type IN ('checking', 'card', 'savings', 'other')),
  balance          REAL,
  currency         TEXT NOT NULL DEFAULT 'ILS',
  updated_at       TEXT
);

CREATE TABLE categories (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  icon             TEXT,
  color            TEXT,
  parent_id        TEXT REFERENCES categories(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer', 'ignore')),
  is_fixed         INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
  id                     TEXT PRIMARY KEY,   -- stable hash, see shared dedupe logic (Phase 3)
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date                   TEXT NOT NULL,
  processed_date         TEXT,
  description            TEXT NOT NULL,
  original_amount        REAL NOT NULL,
  original_currency      TEXT NOT NULL DEFAULT 'ILS',
  charged_amount         REAL NOT NULL,      -- ILS
  type                   TEXT NOT NULL DEFAULT 'normal' CHECK (type IN ('normal', 'installments', 'pending')),
  installment_number     INTEGER,
  installment_total      INTEGER,
  memo                   TEXT,
  category_id            TEXT REFERENCES categories(id) ON DELETE SET NULL,
  user_category_override TEXT REFERENCES categories(id) ON DELETE SET NULL,
  tags                   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  notes                  TEXT,
  is_recurring           INTEGER NOT NULL DEFAULT 0,
  is_excluded            INTEGER NOT NULL DEFAULT 0,
  source_identifier      TEXT,
  source_hash            TEXT,               -- fingerprint used to match pending -> posted
  first_seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_category ON transactions(category_id);

CREATE TABLE category_rules (
  id               TEXT PRIMARY KEY,
  match_type       TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex')),
  pattern          TEXT NOT NULL,
  category_id      TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority         INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL CHECK (created_by IN ('system', 'user'))
);

CREATE TABLE budgets (
  category_id      TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month            TEXT NOT NULL,            -- YYYY-MM
  planned_amount   REAL NOT NULL,
  rollover         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, month)
);

CREATE TABLE recurring_items (
  id               TEXT PRIMARY KEY,
  merchant         TEXT NOT NULL,
  typical_amount   REAL NOT NULL,
  cadence          TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'bimonthly', 'yearly')),
  next_expected    TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended'))
);

CREATE TABLE card_charges (
  account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  charge_date      TEXT NOT NULL,            -- date the card bill hits the bank
  amount           REAL NOT NULL,            -- positive: the amount that will be debited
  currency         TEXT NOT NULL DEFAULT 'ILS',
  PRIMARY KEY (account_id, charge_date)
);
`,
  },
  {
    version: 2,
    name: 'splits and recurring detection',
    sql: `
-- A split transaction is counted through its parts instead of as a whole.
-- amount has the sign of the parent's charged_amount; the parts add up to it.
CREATE TABLE transaction_splits (
  id               TEXT PRIMARY KEY,
  transaction_id   TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id      TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount           REAL NOT NULL
);
CREATE INDEX idx_splits_tx ON transaction_splits(transaction_id);

-- Recurring items are detected from the transactions (source 'auto'); the user can stop one.
ALTER TABLE recurring_items ADD COLUMN merchant_key TEXT;
ALTER TABLE recurring_items ADD COLUMN account_id TEXT;
ALTER TABLE recurring_items ADD COLUMN category_id TEXT;
ALTER TABLE recurring_items ADD COLUMN last_date TEXT;
ALTER TABLE recurring_items ADD COLUMN last_amount REAL;
ALTER TABLE recurring_items ADD COLUMN previous_amount REAL;
ALTER TABLE recurring_items ADD COLUMN occurrences INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_items ADD COLUMN source TEXT NOT NULL DEFAULT 'auto';
`,
  },
];

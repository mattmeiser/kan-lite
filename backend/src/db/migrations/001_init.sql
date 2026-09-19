-- KanLite initial schema. See docs/design/NEW-PROJECT-DESIGN.md ("Quick
-- reference" -> Entities) for the rationale behind each table/field.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  global_role TEXT NOT NULL CHECK (global_role IN ('app_admin', 'app_user')),
  active INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  lockout_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

-- Backs both "new account invite" and "forgot password" -- same flow per the
-- design doc's Auth section: a single-use random token, 30-minute expiry.
CREATE TABLE reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX idx_reset_tokens_user ON reset_tokens (user_id);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  backlog_column_id TEXT REFERENCES columns (id),
  done_column_id TEXT REFERENCES columns (id),
  re_notify_interval_days INTEGER NOT NULL DEFAULT 7,
  daily_notify_time TEXT NOT NULL DEFAULT '08:00',
  recycle_delay_hours INTEGER NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL
);

CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  do_not_notify INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_columns_board ON columns (board_id);

CREATE TABLE swimlanes (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_swimlanes_board ON swimlanes (board_id);

CREATE TABLE board_members (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  board_role TEXT NOT NULL CHECK (board_role IN ('board_admin', 'board_user', 'board_reader')),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX idx_board_members_user ON board_members (user_id);

CREATE TABLE chips (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE INDEX idx_chips_board ON chips (board_id);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES columns (id),
  swimlane_id TEXT REFERENCES swimlanes (id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  assignee_id TEXT REFERENCES users (id),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
  due_date TEXT,
  recurrence_interval_days INTEGER,
  cycle_count INTEGER NOT NULL DEFAULT 0,
  entered_done_at TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cards_board ON cards (board_id);
CREATE INDEX idx_cards_column ON cards (column_id);
CREATE INDEX idx_cards_assignee ON cards (assignee_id);

CREATE TABLE card_chips (
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  chip_id TEXT NOT NULL REFERENCES chips (id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, chip_id)
);

CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);

CREATE INDEX idx_subtasks_card ON subtasks (card_id);

-- kind = 'predecessor' means card_a precedes card_b; 'successor' is never
-- stored, only ever derived by reading a predecessor row from card_b's side.
CREATE TABLE card_links (
  id TEXT PRIMARY KEY,
  card_a_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  card_b_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('related', 'predecessor'))
);

CREATE INDEX idx_card_links_a ON card_links (card_a_id);
CREATE INDEX idx_card_links_b ON card_links (card_b_id);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users (id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at TEXT
);

CREATE INDEX idx_comments_card ON comments (card_id);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users (id),
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  cycle_count INTEGER
);

CREATE INDEX idx_activity_log_card ON activity_log (card_id, timestamp DESC);

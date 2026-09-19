-- Username uniqueness and lookup are case-insensitive (design doc, Entities:
-- "Matt" and "matt" must not become two accounts or two login behaviors),
-- while the as-typed casing is still what's stored and displayed. SQLite's
-- UNIQUE/WHERE comparisons follow a column's collation, so COLLATE NOCASE
-- on the column itself handles both the constraint and every lookup
-- (findUserByUsername, login) with no query changes needed. ALTER TABLE
-- can't change a column's collation in place, so the table is recreated.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  global_role TEXT NOT NULL CHECK (global_role IN ('app_admin', 'app_user')),
  active INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  lockout_until TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO users_new SELECT id, username, email, password_hash, global_role, active, theme, failed_login_count, lockout_until, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

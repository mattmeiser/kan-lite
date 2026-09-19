-- Done card visibility window (design doc, Boards / Decision log #10):
-- board-level setting, in days, 0 = forever (default -- a fresh board's
-- behavior doesn't change until a Board Admin opts in).
ALTER TABLE boards ADD COLUMN done_card_visibility_days INTEGER NOT NULL DEFAULT 0;

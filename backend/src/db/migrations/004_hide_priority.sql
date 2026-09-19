-- Board-level setting: hide the priority badge on card faces for this
-- board. 0 = show (default -- a fresh board's behavior doesn't change
-- until a Board Admin opts in), matching the done-card visibility window's
-- opt-in-by-default convention.
ALTER TABLE boards ADD COLUMN hide_priority INTEGER NOT NULL DEFAULT 0;

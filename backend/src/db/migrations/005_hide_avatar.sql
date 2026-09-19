-- Board-level setting: hide the assignee avatar on card faces for this
-- board. 0 = show (default), same opt-in-by-default convention as
-- hide_priority.
ALTER TABLE boards ADD COLUMN hide_avatar INTEGER NOT NULL DEFAULT 0;

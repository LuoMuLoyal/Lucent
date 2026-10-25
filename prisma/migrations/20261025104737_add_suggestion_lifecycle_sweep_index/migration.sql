-- Lifecycle sweeps scan "WHERE lifecycle_state = ? AND activated_at < ?" with no
-- user filter; every existing index on this table leads with user_id, so the
-- sweep had no usable index. One composite index serves both transitions
-- (active -> fading and fading -> expired): equality on the first column, range
-- on the second.
CREATE INDEX "user_suggestions_lifecycle_state_activated_at_idx"
  ON "user_suggestions" ("lifecycle_state", "activated_at");
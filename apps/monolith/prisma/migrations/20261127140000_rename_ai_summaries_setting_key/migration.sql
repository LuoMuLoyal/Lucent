-- Rename the stored key `aiSummariesEnabled` to `digestEnabled`.
--
-- The setting is unchanged in meaning and value; only its storage key moves. Doing
-- it in SQL rather than leaving a read-time fallback preserves every user's current
-- choice: without this, `UserSetting.value` for the old key becomes unreachable and
-- every user silently reverts to the default while their row lingers forever.
--
-- `ON CONFLICT` guards the case where a user already has the new key (a session that
-- saved after the code deploy): the pre-existing row wins, because it holds the more
-- recent choice, and the stale old row is dropped.
INSERT INTO user_settings (id, user_id, key, value, created_at, updated_at)
SELECT gen_random_uuid(), user_id, 'digestEnabled', value, created_at, now()
FROM user_settings
WHERE key = 'aiSummariesEnabled'
ON CONFLICT (user_id, key) DO NOTHING;

DELETE FROM user_settings WHERE key = 'aiSummariesEnabled';
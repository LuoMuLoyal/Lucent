-- Move the auth identity store from Better Auth's shape to Lucent's.
--
-- Better Auth is no longer a runtime dependency: Lucent owns credential and
-- social identity handling. `accounts` is kept (it was already carrying Lucent
-- semantics — `provider_union_id` / `provider_email` / `raw_profile`) and gains
-- a database-side uuid default so Lucent code no longer has to supply an id.
--
-- `sessions` and `verifications` existed only for Better Auth: Lucent sessions
-- live in `user_sessions` (JWT refresh-token rotation) and verification codes
-- live in the cache. Both tables had no Lucent readers.

-- Better Auth verification tokens (superseded by the cached anti-enumeration
-- verification-code flow).
DROP TABLE "verifications";

-- Better Auth sessions: only written by the library, never read by Lucent code.
DROP TABLE "sessions";

-- Lucent now owns account ids; generate them in the database.
ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- Refresh-token reuse detection (RFC 9700 §4.13.2 / OAuth 2.0 Security BCP).
--
-- Rotation used to DELETE the old session row, which made an already-rotated
-- refresh token indistinguishable from an unknown one: a replay looked exactly
-- like "not found", so it could neither be classified as theft nor revoke the
-- sessions that the legitimate rotation had created.
--
-- The row is now kept as a tombstone:
--   * `family_id` links every session produced by successive rotations, so a
--     detected reuse can revoke the whole chain;
--   * `rotated_at` marks "this refresh token was already exchanged".
--
-- Existing rows each start their own family (they have no rotation history).
-- The retention job (`DataRetentionService.cleanupExpiredSessions`) already
-- deletes rows whose `expires_at` has passed, tombstones included, so this does
-- not grow without bound.

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN "family_id" TEXT;
ALTER TABLE "user_sessions" ADD COLUMN "rotated_at" TIMESTAMPTZ(3);

-- Backfill: every pre-existing session becomes the root of its own family.
UPDATE "user_sessions" SET "family_id" = "id" WHERE "family_id" IS NULL;

ALTER TABLE "user_sessions" ALTER COLUMN "family_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions"("family_id");
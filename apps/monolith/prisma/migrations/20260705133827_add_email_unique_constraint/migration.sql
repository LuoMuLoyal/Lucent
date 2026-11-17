-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- DropIndex
DROP INDEX IF EXISTS "users_email_idx";

ALTER TABLE "user_identities" ADD COLUMN "provider_union_id" TEXT;

CREATE INDEX "user_identities_provider_union_id_idx" ON "user_identities"("provider_union_id");

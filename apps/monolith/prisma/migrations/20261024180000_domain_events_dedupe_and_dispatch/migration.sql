-- DomainEvent outbox (ADR-0025): explicit idempotency key and a separate
-- fan-out timestamp. `published_at` now means "settled"; `dispatched_at` means
-- "every subscriber queue already has its job".

-- AlterTable
ALTER TABLE "domain_events" ADD COLUMN "dedupe_key" TEXT,
ADD COLUMN "dispatched_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_dedupe_key_key" ON "domain_events"("dedupe_key");

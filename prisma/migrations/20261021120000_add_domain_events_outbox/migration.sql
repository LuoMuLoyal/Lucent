-- DomainEvent outbox: cross-context domain events (ADR-0024); append-only delivery queue.
-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "payload_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_events_published_at_occurred_at_idx" ON "domain_events"("published_at", "occurred_at");

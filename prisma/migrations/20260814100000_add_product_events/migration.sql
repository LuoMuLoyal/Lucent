-- CreateEnum
CREATE TYPE "ProductEventName" AS ENUM ('health_event_started', 'health_event_ended', 'health_event_outcome_confirmed', 'suggestion_impression', 'suggestion_actioned', 'review_opened', 'visit_summary_previewed', 'visit_summary_exported', 'visit_summary_share_created', 'visit_summary_share_opened', 'visit_summary_share_revoked');

-- CreateEnum
CREATE TYPE "ProductEventSurface" AS ENUM ('today', 'record', 'review', 'more', 'notification', 'system');

-- CreateEnum
CREATE TYPE "ProductEventResult" AS ENUM ('success', 'failure', 'improved', 'unchanged', 'worsened');

-- CreateTable
CREATE TABLE "user_product_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_event_id" TEXT NOT NULL,
    "name" "ProductEventName" NOT NULL,
    "surface" "ProductEventSurface" NOT NULL,
    "result" "ProductEventResult" NOT NULL,
    "event_status" "HealthEventStatus",
    "suggestion_rule_code" TEXT,
    "app_version" TEXT NOT NULL,
    "platform" "UserDevicePlatform" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_product_events_occurred_at_idx" ON "user_product_events"("occurred_at");

-- CreateIndex
CREATE INDEX "user_product_events_user_id_occurred_at_idx" ON "user_product_events"("user_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_product_events_user_id_client_event_id_key" ON "user_product_events"("user_id", "client_event_id");

-- AddForeignKey
ALTER TABLE "user_product_events" ADD CONSTRAINT "user_product_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

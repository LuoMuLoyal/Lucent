-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('confirmed_risk', 'compliance', 'trend', 'behavior_advice', 'coverage');

-- CreateEnum
CREATE TYPE "SuggestionTriggerType" AS ENUM ('event', 'timer');

-- CreateEnum
CREATE TYPE "SuggestionLifecycleState" AS ENUM ('generated', 'active', 'fading', 'expired', 'dismissed');

-- CreateEnum
CREATE TYPE "SuggestionConfidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "SuggestionFeedbackType" AS ENUM ('accepted', 'later', 'not_applicable', 'suppress');

-- CreateEnum
CREATE TYPE "BaselineDimension" AS ENUM ('water_intake', 'sleep_duration', 'caffeine_intake', 'symptom_severity', 'medication_adherence', 'mood');

-- CreateTable
CREATE TABLE "user_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "trigger_type" "SuggestionTriggerType" NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "boundary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "primary_action" JSONB NOT NULL,
    "secondary_actions" JSONB,
    "priority_score" INTEGER NOT NULL,
    "confidence" "SuggestionConfidence" NOT NULL,
    "lifecycle_state" "SuggestionLifecycleState" NOT NULL DEFAULT 'generated',
    "notification_eligible" BOOLEAN NOT NULL DEFAULT false,
    "notification_sent_at" TIMESTAMPTZ(3),
    "feedback" "SuggestionFeedbackType",
    "feedback_at" TIMESTAMPTZ(3),
    "subtype" TEXT,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "fading_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_suggestion_baselines" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dimension" "BaselineDimension" NOT NULL,
    "days_collected" INTEGER NOT NULL DEFAULT 0,
    "baseline_value" DOUBLE PRECISION,
    "established_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_suggestion_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_suggestion_feedbacks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "suggestion_id" TEXT NOT NULL,
    "suggestion_type" "SuggestionType" NOT NULL,
    "feedback" "SuggestionFeedbackType" NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_suggestion_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_suggestions_user_id_date_idx" ON "user_suggestions"("user_id", "date");

-- CreateIndex
CREATE INDEX "user_suggestions_user_id_date_lifecycle_state_idx" ON "user_suggestions"("user_id", "date", "lifecycle_state");

-- CreateIndex
CREATE INDEX "user_suggestions_user_id_lifecycle_state_generated_at_idx" ON "user_suggestions"("user_id", "lifecycle_state", "generated_at");

-- CreateIndex
CREATE INDEX "user_suggestions_user_id_type_generated_at_idx" ON "user_suggestions"("user_id", "type", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_suggestion_baselines_user_id_dimension_key" ON "user_suggestion_baselines"("user_id", "dimension");

-- CreateIndex
CREATE INDEX "user_suggestion_baselines_user_id_dimension_established_at_idx" ON "user_suggestion_baselines"("user_id", "dimension", "established_at");

-- CreateIndex
CREATE INDEX "user_suggestion_feedbacks_user_id_suggestion_type_expires_at_idx" ON "user_suggestion_feedbacks"("user_id", "suggestion_type", "expires_at");

-- CreateIndex
CREATE INDEX "user_suggestion_feedbacks_user_id_suggestion_id_idx" ON "user_suggestion_feedbacks"("user_id", "suggestion_id");

-- AddForeignKey
ALTER TABLE "user_suggestions" ADD CONSTRAINT "user_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_suggestion_baselines" ADD CONSTRAINT "user_suggestion_baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_suggestion_feedbacks" ADD CONSTRAINT "user_suggestion_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

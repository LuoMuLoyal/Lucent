-- Add payload column for report summary structured data (coverage, observedPattern, lowRiskAction, disclaimer)
ALTER TABLE "assistant_summary_histories" ADD COLUMN "payload" JSONB;

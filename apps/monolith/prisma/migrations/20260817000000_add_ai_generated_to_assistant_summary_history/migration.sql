-- Add ai_generated flag to assistant_summary_histories (F-6).
--
-- Distinguishes LLM-generated today/report summaries from template fallbacks.
-- Existing rows default to false, matching the historical fallback assumption.

-- AlterTable
ALTER TABLE "assistant_summary_histories" ADD COLUMN "ai_generated" BOOLEAN NOT NULL DEFAULT false;

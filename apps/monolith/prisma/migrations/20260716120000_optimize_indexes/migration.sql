-- Migration: Optimize database indexes
-- Date: 2026-07-16
--
-- This migration performs four categories of index optimization:
--
-- P0: Drop redundant indexes (covered by unique constraints or composite indexes)
-- P1: Add missing cross-user indexes (for background job queries)
-- P2: Drop low-cardinality B-tree indexes that don't serve runtime queries
-- P3: Add GIN trigram indexes for ILIKE search queries
--
-- Prisma schema has been updated to remove the corresponding @@index lines.
-- GIN indexes are managed here because Prisma schema does not support GIN operator classes.

-- ═══════════════════════════════════════════════════════════════════
-- P0: Drop redundant indexes
-- ═══════════════════════════════════════════════════════════════════

-- CnMedicineProductLeafletLink: productId index is redundant prefix of unique(productId, leafletId)
DROP INDEX IF EXISTS "cn_medicine_product_leaflet_links_product_id_idx";

-- MedicineLeafletChunk: leafletId index is redundant prefix of unique(leafletId, sourceField, chunkIndex)
DROP INDEX IF EXISTS "medicine_leaflet_chunks_leaflet_id_idx";

-- DrugbankPassageChunk: drugbankId index is redundant prefix of unique(drugbankId, sourceField, chunkIndex)
DROP INDEX IF EXISTS "drugbank_passage_chunks_drugbank_id_idx";

-- UserSetting: userId index is redundant prefix of unique(userId, key)
DROP INDEX IF EXISTS "user_settings_user_id_idx";

-- DataExportRequest: (userId, createdAt) is redundant prefix of (userId, kind, createdAt)
DROP INDEX IF EXISTS "data_export_requests_user_id_created_at_idx";

-- AssistantConversation: (userId, updatedAt) is redundant, covered by (userId, status, updatedAt)
DROP INDEX IF EXISTS "assistant_conversations_user_id_updated_at_idx";

-- UserMedicineDoseLog: (userId, currentMedicineId) is redundant prefix of (userId, currentMedicineId, scheduledFor, scheduledTime)
DROP INDEX IF EXISTS "user_medicine_dose_logs_user_id_current_medicine_id_idx";

-- UserDailyRecord: (userId, occurredAt) is redundant prefix of (userId, occurredAt, occurredTime)
DROP INDEX IF EXISTS "user_daily_records_user_id_occurred_at_idx";

-- CnMedicineProduct: bestMatchType and matchQualityOverall are import-time only
DROP INDEX IF EXISTS "cn_medicine_products_best_match_type_idx";
DROP INDEX IF EXISTS "cn_medicine_products_match_quality_overall_idx";

-- UserSuggestionBaseline: (userId, dimension, establishedAt) is redundant prefix of unique(userId, dimension)
DROP INDEX IF EXISTS "user_suggestion_baselines_user_id_dimension_established_at_idx";

-- ═══════════════════════════════════════════════════════════════════
-- P1: Add missing cross-user indexes
-- ═══════════════════════════════════════════════════════════════════

-- UserSession: for cleanup job scanning expired sessions across all users
CREATE INDEX IF NOT EXISTS "user_sessions_expires_at_idx" ON "user_sessions" ("expires_at");

-- UserReminderDelivery: for delivery scheduler scanning due deliveries across all users
CREATE INDEX IF NOT EXISTS "user_reminder_deliveries_scheduled_for_idx" ON "user_reminder_deliveries" ("scheduled_for");

-- ═══════════════════════════════════════════════════════════════════
-- P2: Drop low-cardinality B-tree indexes (no replacement needed)
-- ═══════════════════════════════════════════════════════════════════

-- User: status index removed — no runtime query filters by status; the column
-- is only written to (e.g. set to active on login). PK index already serves
-- all lookups by id.
DROP INDEX IF EXISTS "users_status_idx";

-- UserCurrentMedicine: replace @@index([userId, isCurrent]) with partial index for current medicines only
DROP INDEX IF EXISTS "user_current_medicines_user_id_is_current_idx";
CREATE INDEX IF NOT EXISTS "user_current_medicines_current_idx" ON "user_current_medicines" ("user_id") WHERE "is_current" = true;

-- UserMedicineReminder: replace @@index([userId, isActive]) with partial index for active non-deleted reminders
-- Columns (scheduled_hour, scheduled_minute) match the orderBy in runtime queries.
DROP INDEX IF EXISTS "user_medicine_reminders_user_id_is_active_idx";
CREATE INDEX IF NOT EXISTS "user_medicine_reminders_active_idx" ON "user_medicine_reminders" ("user_id", "scheduled_hour", "scheduled_minute")
  WHERE "is_active" = true AND "deleted_at" IS NULL;

-- UserNotification: replace @@index([userId, isRead, createdAt]) with partial index for unread only
DROP INDEX IF EXISTS "user_notifications_user_id_is_read_created_at_idx";
CREATE INDEX IF NOT EXISTS "user_notifications_unread_idx" ON "user_notifications" ("user_id", "created_at" DESC) WHERE "is_read" = false;

-- MedicineSafetyTip: index removed — table is tiny (dozens of rows), query
-- (where isActive=true) is served by seq scan. No partial index needed.
DROP INDEX IF EXISTS "medicine_safety_tips_is_active_sort_order_idx";

-- LegalDocument: index removed — table is tiny (< 10 rows), query
-- (where isActive=true) is served by seq scan. findOne uses PK on docType.
DROP INDEX IF EXISTS "legal_documents_is_active_idx";

-- MealDishTemplate: replace @@index([status]) with partial index for active templates
-- Column (normalized_dish_name) matches the OR-in filter in decomposition queries.
DROP INDEX IF EXISTS "meal_dish_templates_status_idx";
CREATE INDEX IF NOT EXISTS "meal_dish_templates_active_idx" ON "meal_dish_templates" ("normalized_dish_name") WHERE "status" = 'active';

-- CnMedicineLeaflet: approvalCodes B-tree index on JSONB column is not usable
-- by PostgreSQL. No GIN replacement — no runtime query filters on approval_codes.
DROP INDEX IF EXISTS "cn_medicine_leaflets_approval_codes_idx";

-- ═══════════════════════════════════════════════════════════════════
-- P3: GIN trigram indexes for ILIKE search
-- ═══════════════════════════════════════════════════════════════════

-- Enable pg_trgm extension for trigram-based ILIKE acceleration
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CnMedicineProduct: accelerate ILIKE '%query%' on all columns used in buildWhere()
-- Query: cn.service.ts buildWhere() — OR of contains(mode: insensitive) on 6 columns
CREATE INDEX IF NOT EXISTS "cn_medicine_products_name_trgm_idx"
  ON "cn_medicine_products" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "cn_medicine_products_brand_name_trgm_idx"
  ON "cn_medicine_products" USING gin ("brand_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "cn_medicine_products_approval_number_trgm_idx"
  ON "cn_medicine_products" USING gin ("approval_number" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "cn_medicine_products_barcode_trgm_idx"
  ON "cn_medicine_products" USING gin ("barcode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "cn_medicine_products_national_drug_code_trgm_idx"
  ON "cn_medicine_products" USING gin ("national_drug_code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "cn_medicine_products_search_text_trgm_idx"
  ON "cn_medicine_products" USING gin ("search_text" gin_trgm_ops);

-- DrugbankDrug: accelerate ILIKE '%query%' on all columns used in buildWhere()
-- Query: drugbank.service.ts buildWhere() + entity-resolve.service.ts — OR of contains on 4 columns
CREATE INDEX IF NOT EXISTS "drugbank_drugs_name_trgm_idx"
  ON "drugbank_drugs" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "drugbank_drugs_cas_number_trgm_idx"
  ON "drugbank_drugs" USING gin ("cas_number" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "drugbank_drugs_unii_trgm_idx"
  ON "drugbank_drugs" USING gin ("unii" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "drugbank_drugs_search_text_trgm_idx"
  ON "drugbank_drugs" USING gin ("search_text" gin_trgm_ops);

-- FoodCompositionItem: accelerate startsWith (LIKE 'prefix%') on normalized_name and search_text
-- Query: grounding.service.ts fuzzyCandidates — startsWith on normalizedName and searchText
CREATE INDEX IF NOT EXISTS "food_composition_items_normalized_name_trgm_idx"
  ON "food_composition_items" USING gin ("normalized_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "food_composition_items_search_text_trgm_idx"
  ON "food_composition_items" USING gin ("search_text" gin_trgm_ops);

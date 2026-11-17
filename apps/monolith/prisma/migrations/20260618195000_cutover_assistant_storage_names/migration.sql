ALTER TYPE "AiChatConversationStatus" RENAME TO "AssistantConversationStatus";
ALTER TYPE "AiChatMessageRole" RENAME TO "AssistantMessageRole";

ALTER TABLE "ai_chat_conversations" RENAME TO "assistant_conversations";
ALTER TABLE "ai_chat_messages" RENAME TO "assistant_messages";
ALTER TABLE "ai_summary_histories" RENAME TO "assistant_summary_histories";

ALTER TABLE "assistant_conversations"
RENAME CONSTRAINT "ai_chat_conversations_pkey" TO "assistant_conversations_pkey";
ALTER TABLE "assistant_messages"
RENAME CONSTRAINT "ai_chat_messages_pkey" TO "assistant_messages_pkey";
ALTER TABLE "assistant_summary_histories"
RENAME CONSTRAINT "ai_summary_histories_pkey" TO "assistant_summary_histories_pkey";

ALTER TABLE "assistant_conversations"
RENAME CONSTRAINT "ai_chat_conversations_user_id_fkey" TO "assistant_conversations_user_id_fkey";
ALTER TABLE "assistant_messages"
RENAME CONSTRAINT "ai_chat_messages_conversation_id_fkey" TO "assistant_messages_conversation_id_fkey";
ALTER TABLE "assistant_messages"
RENAME CONSTRAINT "ai_chat_messages_user_id_fkey" TO "assistant_messages_user_id_fkey";
ALTER TABLE "assistant_summary_histories"
RENAME CONSTRAINT "ai_summary_histories_user_id_fkey" TO "assistant_summary_histories_user_id_fkey";

ALTER INDEX "ai_chat_conversations_user_id_updated_at_idx"
RENAME TO "assistant_conversations_user_id_updated_at_idx";
ALTER INDEX "ai_chat_conversations_user_id_last_message_at_idx"
RENAME TO "assistant_conversations_user_id_last_message_at_idx";
ALTER INDEX "ai_chat_conversations_user_id_status_updated_at_idx"
RENAME TO "assistant_conversations_user_id_status_updated_at_idx";
ALTER INDEX "ai_chat_messages_conversation_id_created_at_idx"
RENAME TO "assistant_messages_conversation_id_created_at_idx";
ALTER INDEX "ai_chat_messages_user_id_created_at_idx"
RENAME TO "assistant_messages_user_id_created_at_idx";
ALTER INDEX "ai_summary_histories_user_id_scope_key_key"
RENAME TO "assistant_summary_histories_user_id_scope_key_key";
ALTER INDEX "ai_summary_histories_user_id_kind_generated_at_idx"
RENAME TO "assistant_summary_histories_user_id_kind_generated_at_idx";
ALTER INDEX "ai_summary_histories_user_id_date_idx"
RENAME TO "assistant_summary_histories_user_id_date_idx";
ALTER INDEX "ai_summary_histories_user_id_range_key_generated_at_idx"
RENAME TO "assistant_summary_histories_user_id_range_key_generated_at_idx";

UPDATE "user_settings"
SET "key" = CASE "key"
  WHEN 'aiChatEnabled' THEN 'assistantEnabled'
  WHEN 'aiChatMemoryEnabled' THEN 'assistantMemoryEnabled'
  WHEN 'aiChatContext.healthProfile' THEN 'assistantContext.healthProfile'
  WHEN 'aiChatContext.dailyRecords' THEN 'assistantContext.dailyRecords'
  WHEN 'aiChatContext.sleepRecords' THEN 'assistantContext.sleepRecords'
  WHEN 'aiChatContext.currentMedicines' THEN 'assistantContext.currentMedicines'
  ELSE "key"
END
WHERE "key" IN (
  'aiChatEnabled',
  'aiChatMemoryEnabled',
  'aiChatContext.healthProfile',
  'aiChatContext.dailyRecords',
  'aiChatContext.sleepRecords',
  'aiChatContext.currentMedicines'
);

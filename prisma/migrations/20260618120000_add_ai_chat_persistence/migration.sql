-- CreateEnum
CREATE TYPE "AiChatConversationStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "AiChatMessageRole" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "ai_chat_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "status" "AiChatConversationStatus" NOT NULL DEFAULT 'active',
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "AiChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "used_tools" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_chat_conversations_user_id_updated_at_idx" ON "ai_chat_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_chat_conversations_user_id_last_message_at_idx" ON "ai_chat_conversations"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "ai_chat_conversations_user_id_status_updated_at_idx" ON "ai_chat_conversations"("user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "ai_chat_messages_conversation_id_created_at_idx" ON "ai_chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_chat_messages_user_id_created_at_idx" ON "ai_chat_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: assistant_memories.source_conversation_id → assistant_conversations.id
-- ON DELETE SET NULL so deleting a conversation preserves the memory content.
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_source_conversation_id_fkey"
    FOREIGN KEY ("source_conversation_id") REFERENCES "assistant_conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex for source_conversation_id lookups
CREATE INDEX "assistant_memories_source_conversation_id_idx"
    ON "assistant_memories"("source_conversation_id");

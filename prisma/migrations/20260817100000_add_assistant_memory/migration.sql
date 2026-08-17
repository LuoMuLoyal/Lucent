-- CreateTable
CREATE TABLE "assistant_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_conversation_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_memories_user_id_created_at_idx" ON "assistant_memories"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

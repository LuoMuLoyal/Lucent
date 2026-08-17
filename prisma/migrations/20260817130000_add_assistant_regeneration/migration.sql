-- CreateTable
CREATE TABLE "assistant_regenerations" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "checkpoint_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_regenerations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_regenerations_conversation_id_source_message_id_idx" ON "assistant_regenerations"("conversation_id", "source_message_id");

-- CreateIndex
CREATE INDEX "assistant_regenerations_user_id_created_at_idx" ON "assistant_regenerations"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_regenerations" ADD CONSTRAINT "assistant_regenerations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

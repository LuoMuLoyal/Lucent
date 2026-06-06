-- CreateEnum
CREATE TYPE "DailyRecordAttachmentKind" AS ENUM ('image');

-- CreateTable
CREATE TABLE "user_daily_record_attachments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "kind" "DailyRecordAttachmentKind" NOT NULL DEFAULT 'image',
    "object_key" TEXT NOT NULL,
    "bucket" TEXT,
    "provider" TEXT,
    "file_name" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "public_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_daily_record_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_daily_record_attachments_user_id_record_id_idx" ON "user_daily_record_attachments"("user_id", "record_id");

-- AddForeignKey
ALTER TABLE "user_daily_record_attachments" ADD CONSTRAINT "user_daily_record_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_daily_record_attachments" ADD CONSTRAINT "user_daily_record_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "user_daily_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

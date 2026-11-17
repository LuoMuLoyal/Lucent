ALTER TABLE "data_export_requests"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'hospital',
ADD COLUMN "format" TEXT NOT NULL DEFAULT 'pdf',
ADD COLUMN "range" TEXT NOT NULL DEFAULT 'last_7_days',
ADD COLUMN "object_key" TEXT,
ADD COLUMN "bucket" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "file_name" TEXT,
ADD COLUMN "file_size_bytes" INTEGER;

CREATE INDEX "data_export_requests_user_id_kind_created_at_idx"
ON "data_export_requests"("user_id", "kind", "created_at");

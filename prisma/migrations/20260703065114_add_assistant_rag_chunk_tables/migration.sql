/*
  Warnings:

  - You are about to drop the column `geriatric_use` on the `cn_medicine_leaflets` table. All the data in the column will be lost.
  - You are about to drop the column `pediatric_use` on the `cn_medicine_leaflets` table. All the data in the column will be lost.
  - You are about to drop the column `pregnancy_lactation` on the `cn_medicine_leaflets` table. All the data in the column will be lost.
  - You are about to drop the column `geriatric_use` on the `cn_medicine_products` table. All the data in the column will be lost.
  - You are about to drop the column `pediatric_use` on the `cn_medicine_products` table. All the data in the column will be lost.
  - You are about to drop the column `pregnancy_lactation` on the `cn_medicine_products` table. All the data in the column will be lost.
  - You are about to drop the column `lactation_state` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `pregnancy_state` on the `user_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "geriatric_use",
DROP COLUMN "pediatric_use",
DROP COLUMN "pregnancy_lactation";

-- AlterTable
ALTER TABLE "cn_medicine_products" DROP COLUMN "geriatric_use",
DROP COLUMN "pediatric_use",
DROP COLUMN "pregnancy_lactation";

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "lactation_state",
DROP COLUMN "pregnancy_state";

-- DropEnum
DROP TYPE "LactationState";

-- DropEnum
DROP TYPE "PregnancyState";

-- CreateTable
CREATE TABLE "medical_qa_chunks" (
    "id" TEXT NOT NULL,
    "qa_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "safety_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_qa_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drugbank_passage_chunks" (
    "id" TEXT NOT NULL,
    "drugbank_id" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "source_version" TEXT,
    "source_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_passage_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medical_qa_chunks_qa_id_key" ON "medical_qa_chunks"("qa_id");

-- CreateIndex
CREATE INDEX "medical_qa_chunks_safety_label_idx" ON "medical_qa_chunks"("safety_label");

-- CreateIndex
CREATE INDEX "drugbank_passage_chunks_drugbank_id_idx" ON "drugbank_passage_chunks"("drugbank_id");

-- CreateIndex
CREATE INDEX "drugbank_passage_chunks_source_field_idx" ON "drugbank_passage_chunks"("source_field");

-- CreateIndex
CREATE UNIQUE INDEX "drugbank_passage_chunks_drugbank_id_source_field_chunk_inde_key" ON "drugbank_passage_chunks"("drugbank_id", "source_field", "chunk_index");

-- AddForeignKey
ALTER TABLE "drugbank_passage_chunks" ADD CONSTRAINT "drugbank_passage_chunks_drugbank_id_fkey" FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DrugBank 序列数据：靶点蛋白/基因序列 + 生物药序列。
--
-- 靶点序列来自 protein.fasta / gene.fasta —— 两者表头格式完全相同，靠 source_dataset
-- 区分：protein_fasta 是氨基酸序列，gene_fasta 是同一靶点的编码核苷酸序列（约 3 倍长）。
-- 不与 drugbank_targets 建外键：那边的 uniprot_id 可空且非唯一，无法承载外键约束，
-- 消费方按 uniprot_id 关联。
--
-- 生物药序列来自 drug sequences.fasta —— 一个药物可有多条（实测 335 个药物共 615 条，
-- 最多 11 条），因此链描述必须进唯一键，否则会静默丢数据。表头里药物名之后的部分
-- （sequence / heavy chain / SUBUNIT_1 / (FSH) …）原样保存，不强拆成 name/chain 两列。

-- CreateTable
CREATE TABLE "drugbank_target_sequences" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "source_dataset" TEXT NOT NULL,
    "uniprot_id" TEXT NOT NULL,
    "target_name" TEXT,
    "drugbank_ids" JSONB,
    "sequence" TEXT NOT NULL,
    "length" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_target_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drugbank_drug_sequences" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sequence" TEXT NOT NULL,
    "length" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_drug_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drugbank_target_sequences_uniprot_id_idx"
ON "drugbank_target_sequences"("uniprot_id");

-- CreateIndex
CREATE UNIQUE INDEX "drugbank_target_sequences_source_dataset_uniprot_id_key"
ON "drugbank_target_sequences"("source_dataset", "uniprot_id");

-- CreateIndex
CREATE INDEX "drugbank_drug_sequences_drugbank_id_idx"
ON "drugbank_drug_sequences"("drugbank_id");

-- CreateIndex
CREATE UNIQUE INDEX "drugbank_drug_sequences_drugbank_id_description_key"
ON "drugbank_drug_sequences"("drugbank_id", "description");

-- AddForeignKey
ALTER TABLE "drugbank_target_sequences"
ADD CONSTRAINT "drugbank_target_sequences_import_run_id_fkey"
FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drugbank_drug_sequences"
ADD CONSTRAINT "drugbank_drug_sequences_import_run_id_fkey"
FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drugbank_drug_sequences"
ADD CONSTRAINT "drugbank_drug_sequences_drugbank_id_fkey"
FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id")
ON DELETE CASCADE ON UPDATE CASCADE;

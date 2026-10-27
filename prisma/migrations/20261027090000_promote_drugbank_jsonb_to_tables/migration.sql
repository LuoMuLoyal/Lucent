-- 把 DrugBank 的多值 JsonB 字段提升为关系表。
--
-- 判断标准是**查询方式**而不是数据形状（与 PRODUCT.md §三 一致）：只有当一件事
-- 需要反查（"哪些药和 X 相互作用"）或按内部字段筛选（"哪些药属于 withdrawn"）
-- 时才建表。规模见每张表的注释（19,842 个药的实测值）。
--
-- 被取代的 JsonB 列在同一迁移里 DROP：留着会出现两份事实源，而 JsonB 那份
-- 在导入器改写后将不再更新，属于典型的"静默过期"。

-- ── 1. 药物-药物相互作用（4,631 药 / 291 万条）────────────────────────────
CREATE TABLE "drugbank_drug_interactions" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "interacts_with_id" TEXT NOT NULL,
    "interacts_with_name" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_drug_interactions_pkey" PRIMARY KEY ("id")
);

-- 对方药物可能不在 drugbank_drugs 里（已撤市/外部来源），因此不建外键。
CREATE UNIQUE INDEX "drugbank_drug_interactions_drugbank_id_interacts_with_id_key"
    ON "drugbank_drug_interactions"("drugbank_id", "interacts_with_id");
CREATE INDEX "drugbank_drug_interactions_interacts_with_id_idx"
    ON "drugbank_drug_interactions"("interacts_with_id");

-- ── 2. 商品/上市信息（4,465 药 / 47 万条）────────────────────────────────
CREATE TABLE "drugbank_products" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "labeller" TEXT,
    "ndc_id" TEXT,
    "ndc_product_code" TEXT,
    "dpd_id" TEXT,
    "ema_product_code" TEXT,
    "ema_ma_number" TEXT,
    "dosage_form" TEXT,
    "strength" TEXT,
    "route" TEXT,
    "fda_application_number" TEXT,
    "generic" BOOLEAN,
    "over_the_counter" BOOLEAN,
    "approved" BOOLEAN,
    "country" TEXT,
    "started_marketing_on" DATE,
    "ended_marketing_on" DATE,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drugbank_products_drugbank_id_idx" ON "drugbank_products"("drugbank_id");
CREATE INDEX "drugbank_products_name_idx" ON "drugbank_products"("name");
CREATE INDEX "drugbank_products_ndc_product_code_idx" ON "drugbank_products"("ndc_product_code");
CREATE INDEX "drugbank_products_labeller_idx" ON "drugbank_products"("labeller");
-- 撤市筛查按退市日期过滤
CREATE INDEX "drugbank_products_ended_marketing_on_idx" ON "drugbank_products"("ended_marketing_on");

-- ── 3. 同义词（18,160 药 / 42,961 条，91.5% 覆盖）───────────────────────
CREATE TABLE "drugbank_synonyms" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "synonym" TEXT NOT NULL,
    "language" TEXT,
    "coder" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_synonyms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_synonyms_drugbank_id_synonym_key"
    ON "drugbank_synonyms"("drugbank_id", "synonym");
-- 按同义词搜索；pg_trgm 已在本库启用（1.6）
CREATE INDEX "drugbank_synonyms_synonym_idx" ON "drugbank_synonyms"("synonym");

-- ── 4. 生产商（829 药 / 5,669 条）────────────────────────────────────────
CREATE TABLE "drugbank_manufacturers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generic" BOOLEAN,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_manufacturers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_manufacturers_drugbank_id_name_key"
    ON "drugbank_manufacturers"("drugbank_id", "name");
CREATE INDEX "drugbank_manufacturers_name_idx" ON "drugbank_manufacturers"("name");

-- ── 5. 分包装商（1,215 药 / 20,355 条）──────────────────────────────────
CREATE TABLE "drugbank_packagers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_packagers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_packagers_drugbank_id_name_key"
    ON "drugbank_packagers"("drugbank_id", "name");
CREATE INDEX "drugbank_packagers_name_idx" ON "drugbank_packagers"("name");

-- ── 6. 剂量/剂型/途径（5,276 药 / 100,085 条）───────────────────────────
CREATE TABLE "drugbank_dosages" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "form" TEXT,
    "route" TEXT,
    "strength" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_dosages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_dosages_drugbank_id_form_route_strength_key"
    ON "drugbank_dosages"("drugbank_id", "form", "route", "strength");
CREATE INDEX "drugbank_dosages_form_idx" ON "drugbank_dosages"("form");
CREATE INDEX "drugbank_dosages_route_idx" ON "drugbank_dosages"("route");

-- ── 7. 外部标识符（17,309 药 / 93,636 条）───────────────────────────────
CREATE TABLE "drugbank_external_identifiers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_external_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_external_identifiers_drugbank_id_resource_identifier_key"
    ON "drugbank_external_identifiers"("drugbank_id", "resource", "identifier");
-- 按外部 ID 反查本库药物（A5：用户手上有 ChEBI:15377）
CREATE INDEX "drugbank_external_identifiers_resource_identifier_idx"
    ON "drugbank_external_identifiers"("resource", "identifier");

-- ── 8. 化学分类（11,195 药，每药一条路径）───────────────────────────────
CREATE TABLE "drugbank_classifications" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "kingdom" TEXT,
    "superclass" TEXT,
    "class" TEXT,
    "subclass" TEXT,
    "direct_parent" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drugbank_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_classifications_drugbank_id_key"
    ON "drugbank_classifications"("drugbank_id");
CREATE INDEX "drugbank_classifications_kingdom_idx" ON "drugbank_classifications"("kingdom");
CREATE INDEX "drugbank_classifications_superclass_idx" ON "drugbank_classifications"("superclass");
CREATE INDEX "drugbank_classifications_class_idx" ON "drugbank_classifications"("class");
CREATE INDEX "drugbank_classifications_subclass_idx" ON "drugbank_classifications"("subclass");

-- ── 9. 状态分组（19,842 药全覆盖 / 7,466 条）────────────────────────────
CREATE TABLE "drugbank_groups" (
    "drugbank_id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "import_run_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_groups_pkey" PRIMARY KEY ("drugbank_id","group_name")
);

CREATE INDEX "drugbank_groups_group_name_idx" ON "drugbank_groups"("group_name");

-- ── 10. 外键（全部 ON DELETE CASCADE，随药物删除）───────────────────────
ALTER TABLE "drugbank_drug_interactions"
    ADD CONSTRAINT "drugbank_drug_interactions_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_drug_interactions"
    ADD CONSTRAINT "drugbank_drug_interactions_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_products"
    ADD CONSTRAINT "drugbank_products_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_products"
    ADD CONSTRAINT "drugbank_products_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_synonyms"
    ADD CONSTRAINT "drugbank_synonyms_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_synonyms"
    ADD CONSTRAINT "drugbank_synonyms_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_manufacturers"
    ADD CONSTRAINT "drugbank_manufacturers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_manufacturers"
    ADD CONSTRAINT "drugbank_manufacturers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_packagers"
    ADD CONSTRAINT "drugbank_packagers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_packagers"
    ADD CONSTRAINT "drugbank_packagers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_dosages"
    ADD CONSTRAINT "drugbank_dosages_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_dosages"
    ADD CONSTRAINT "drugbank_dosages_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_external_identifiers"
    ADD CONSTRAINT "drugbank_external_identifiers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_external_identifiers"
    ADD CONSTRAINT "drugbank_external_identifiers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_classifications"
    ADD CONSTRAINT "drugbank_classifications_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_classifications"
    ADD CONSTRAINT "drugbank_classifications_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_groups"
    ADD CONSTRAINT "drugbank_groups_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_groups"
    ADD CONSTRAINT "drugbank_groups_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 11. 删除被取代的 JsonB 列 ──────────────────────────────────────────
-- 这些列的数据在新表里重建（导入器已改写），留着会成为不再更新的第二份事实源。
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "groups";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "classification";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "synonyms";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "products";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "drug_interactions";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "external_identifiers";

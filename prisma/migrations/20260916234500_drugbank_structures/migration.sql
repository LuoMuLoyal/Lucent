-- DrugBank 计算结构描述符（来自 structures.sdf）。
--
-- 一药一行：实测 14622 条记录对 14622 个不同 DRUGBANK_ID（且与 DATABASE_ID 恒等），
-- 故 drugbank_id 即自然主键，不存在需要合并的重复记录。
--
-- 只落 XML 导入没有提供的字段。SDF 里另有 SYNONYMS / PRODUCTS / DRUG_GROUPS /
-- SECONDARY_ACCESSION_NUMBERS，但它们与 drugbank_drugs 从 XML 拿到的一致
-- （伊马替尼两边都是同样 3 条同义词），重复导入只会产生第二份互相竞争的副本。
--
-- 刻意不收 JCHEM_TRADITIONAL_IUPAC：该字段上游系统性张冠李戴（阿司匹林读成地塞米松
-- 磷酸盐、二甲双胍与布洛芬都读成 biotin），而同一条记录里 JCHEM_IUPAC / INCHI_KEY /
-- FORMULA 均正确 —— 排除字段错位，是字段本身不可信。
--
-- 不收 molblock（原子/键坐标）：该文件实为纯 2D，没有可消费的构象数据。

-- CreateTable
CREATE TABLE "drugbank_structures" (
    "drugbank_id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "smiles" TEXT,
    "inchi_identifier" TEXT,
    "inchi_key" TEXT,
    "formula" TEXT,
    "molecular_weight" DOUBLE PRECISION,
    "exact_mass" DOUBLE PRECISION,
    "jchem_iupac" TEXT,
    "alogps_solubility" TEXT,
    "salts" JSONB,
    "jchem_atom_count" INTEGER,
    "jchem_formal_charge" INTEGER,
    "jchem_ghose_filter" INTEGER,
    "jchem_rule_of_five" INTEGER,
    "jchem_acceptor_count" INTEGER,
    "jchem_donor_count" INTEGER,
    "jchem_bioavailability" INTEGER,
    "jchem_mddr_like_rule" INTEGER,
    "jchem_number_of_rings" INTEGER,
    "jchem_rotatable_bond_count" INTEGER,
    "jchem_veber_rule" INTEGER,
    "jchem_physiological_charge" INTEGER,
    "jchem_neutral_charge" INTEGER,
    "jchem_average_polarizability" DOUBLE PRECISION,
    "jchem_polar_surface_area" DOUBLE PRECISION,
    "jchem_refractivity" DOUBLE PRECISION,
    "jchem_logp" DOUBLE PRECISION,
    "jchem_pka" DOUBLE PRECISION,
    "jchem_pka_strongest_acidic" DOUBLE PRECISION,
    "jchem_pka_strongest_basic" DOUBLE PRECISION,
    "jchem_average_neutral_microspecies_charge" DOUBLE PRECISION,
    "alogps_logp" DOUBLE PRECISION,
    "alogps_logs" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_structures_pkey" PRIMARY KEY ("drugbank_id")
);

-- CreateIndex
CREATE INDEX "drugbank_structures_inchi_key_idx"
ON "drugbank_structures"("inchi_key");

-- AddForeignKey
ALTER TABLE "drugbank_structures"
ADD CONSTRAINT "drugbank_structures_import_run_id_fkey"
FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drugbank_structures"
ADD CONSTRAINT "drugbank_structures_drugbank_id_fkey"
FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- 说明书字段归一化派生列（validity_period_months / ingredients_clean）。
--
-- 背景：这些列在源数据里是**同一语义的多种写法**，直接切分会让同一句话产生多个
-- 不同 chunk，各自付一次 LLM 抽取费。实测 validity_period 有 227 种写法 / 19,533 行：
--   - 句末句号 2,773 行（`24个月。`）
--   - `暂定` 前缀 1,504 行（`暂定一年半`）
--   - 中文数字 1,582 行（`二年`）
-- 归一化为「月数」后塌缩到 19 个值、覆盖 99.4% 行，使同一语义命中同一 LightRAG
-- 抽取缓存（缓存键为 chunk 内容级，已在迁移日志 2026-09-26 验证）。
--
-- **原始列一律不改写**：validity_period / ingredients 保留源站原文，归一化结果是
-- 派生列，可随时按新规则重算。这样既保留溯源，也不把清洗规则焊死在数据里。
--
-- validity_period_months 允许为 NULL：120 行是自由文本（混合包装规格
-- `塑料瓶装36个月，玻璃瓶装24个月…`、`详见说明书`、误入的批准文号），
-- 无法可靠归一化 —— 宁可为空，不做猜测。

-- AlterTable
ALTER TABLE "cn_medicine_leaflets"
  ADD COLUMN "validity_period_months" INTEGER,
  ADD COLUMN "ingredients_clean" TEXT;

-- 归一化结果只用于检索侧比较，不参与业务查询，但按值分组统计需要索引。
CREATE INDEX "cn_medicine_leaflets_validity_period_months_idx"
  ON "cn_medicine_leaflets" ("validity_period_months");

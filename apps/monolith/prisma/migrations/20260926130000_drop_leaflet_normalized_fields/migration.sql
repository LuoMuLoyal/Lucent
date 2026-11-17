-- 删除归一化派生列。
--
-- 归一化已改为**就地改写原始列**（见 `overwrite-leaflet-normalization.ts`），
-- `validity_period` / `ingredients` 自身即为归一化后的值，派生列不再需要。
--
-- ⚠️ 这是不可逆的结构变更：删除前请确认 `validity_period` 已是「N个月」口径。
-- 已实测：21,142 行中 19,411 行已归一化为整数月，122 行为无法归一化的自由文本
-- （原样保留），其余为空。

-- DropIndex
DROP INDEX IF EXISTS "cn_medicine_leaflets_validity_period_months_idx";

-- AlterTable
ALTER TABLE "cn_medicine_leaflets"
  DROP COLUMN IF EXISTS "validity_period_months",
  DROP COLUMN IF EXISTS "ingredients_clean";

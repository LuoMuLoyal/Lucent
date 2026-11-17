-- 餐食分析投影列：列表条目与聚合直接读列，不再解析 payload JSONB。
CREATE TYPE "MealCalorieBucket" AS ENUM ('low', 'medium', 'high');

ALTER TABLE "user_daily_records"
    ADD COLUMN "meal_headline" TEXT,
    ADD COLUMN "meal_calorie_min" INTEGER,
    ADD COLUMN "meal_calorie_max" INTEGER,
    ADD COLUMN "meal_calorie_bucket" "MealCalorieBucket";

-- 人工确认步骤取消后 coverage 概念已删除（v2 只有 analyzing | analyzed | analysis_failed）。
ALTER TABLE "user_daily_records" DROP COLUMN "meal_analysis_coverage";
DROP TYPE "MealAnalysisCoverage";

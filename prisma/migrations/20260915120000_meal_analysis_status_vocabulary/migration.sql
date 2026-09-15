-- 餐食分析状态词表收敛：analyzing | analyzed | analysis_failed。
-- 人工「确认」步骤已删除，unconfirmed / confirmed 两个值不再存在；
-- 旧数据里这两个状态等价于「分析已产出」，就地映射为 analyzed。
CREATE TYPE "MealAnalysisStatus_new" AS ENUM ('analyzing', 'analyzed', 'analysis_failed');

ALTER TABLE "user_daily_records"
    ALTER COLUMN "meal_analysis_status" TYPE "MealAnalysisStatus_new"
    USING (
        CASE "meal_analysis_status"::text
            WHEN 'unconfirmed' THEN 'analyzed'::"MealAnalysisStatus_new"
            WHEN 'confirmed' THEN 'analyzed'::"MealAnalysisStatus_new"
            ELSE "meal_analysis_status"::text::"MealAnalysisStatus_new"
        END
    );

DROP TYPE "MealAnalysisStatus";
ALTER TYPE "MealAnalysisStatus_new" RENAME TO "MealAnalysisStatus";

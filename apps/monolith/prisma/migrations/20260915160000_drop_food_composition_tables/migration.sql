-- 餐食分析 v2（一次多模态直出）后，成分表接地链路已整体删除（ADR-0020）：
-- 这三张表与 meal_dish_templates / meal_dish_template_ingredients 已无任何消费者，
-- 对应导入脚本（scripts/import/food/）与 pnpm import:food:* 一并下线。
-- 顺序：先删子表（模板配料 → 模板），再删成分表（items → categories → imports）。
DROP TABLE IF EXISTS "meal_dish_template_ingredients";
DROP TABLE IF EXISTS "meal_dish_templates";
DROP TABLE IF EXISTS "food_composition_items";
DROP TABLE IF EXISTS "food_composition_categories";
DROP TABLE IF EXISTS "food_composition_imports";

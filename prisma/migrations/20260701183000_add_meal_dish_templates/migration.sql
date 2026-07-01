CREATE TABLE "meal_dish_templates" (
    "id" TEXT NOT NULL,
    "normalized_dish_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "aliases" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'seeded',
    "search_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_dish_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meal_dish_template_ingredients" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "ingredient_name" TEXT NOT NULL,
    "normalized_ingredient_name" TEXT NOT NULL,
    "food_composition_item_id" TEXT,
    "default_ratio" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_dish_template_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meal_dish_templates_normalized_dish_name_key" ON "meal_dish_templates"("normalized_dish_name");
CREATE INDEX "meal_dish_templates_display_name_idx" ON "meal_dish_templates"("display_name");
CREATE INDEX "meal_dish_templates_status_idx" ON "meal_dish_templates"("status");
CREATE INDEX "meal_dish_templates_search_text_idx" ON "meal_dish_templates"("search_text");
CREATE INDEX "meal_dish_template_ingredients_template_id_sort_order_idx" ON "meal_dish_template_ingredients"("template_id", "sort_order");
CREATE INDEX "meal_dish_template_ingredients_normalized_ingredient_name_idx" ON "meal_dish_template_ingredients"("normalized_ingredient_name");
CREATE INDEX "meal_dish_template_ingredients_food_composition_item_id_idx" ON "meal_dish_template_ingredients"("food_composition_item_id");

ALTER TABLE "meal_dish_template_ingredients" ADD CONSTRAINT "meal_dish_template_ingredients_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_dish_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meal_dish_template_ingredients" ADD CONSTRAINT "meal_dish_template_ingredients_food_composition_item_id_fkey" FOREIGN KEY ("food_composition_item_id") REFERENCES "food_composition_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

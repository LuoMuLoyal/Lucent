-- 补齐 UserSuggestion.locale 列与 (userId, date, locale) 索引的缺失迁移
-- （schema.prisma 已含该字段与索引，但此前没有任何迁移添加它，导致
--  today-suggestion 相关接口在按迁移历史构建的数据库上 500）
ALTER TABLE "user_suggestions" ADD COLUMN "locale" TEXT;

CREATE INDEX "user_suggestions_user_id_date_locale_idx" ON "user_suggestions"("user_id", "date", "locale");

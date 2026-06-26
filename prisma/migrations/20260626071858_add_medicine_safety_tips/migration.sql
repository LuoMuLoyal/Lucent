-- CreateTable
CREATE TABLE "medicine_safety_tips" (
    "id" TEXT NOT NULL,
    "content_zh" TEXT NOT NULL,
    "content_en" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_safety_tips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicine_safety_tips_is_active_sort_order_idx" ON "medicine_safety_tips"("is_active", "sort_order");

-- Seed initial safety tips
INSERT INTO "medicine_safety_tips" ("id", "content_zh", "content_en", "category", "sort_order") VALUES
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '服药期间如需饮酒，建议间隔至少 24 小时以上。', 'If alcohol is unavoidable during medication, leave at least 24 hours when possible.', 'alcohol', 1),
('a1b2c3d4-e5f6-7890-abcd-ef1234567891', '咖啡 / 浓茶 / 能量饮料可能影响部分药物效果，注意适量。', 'Coffee, strong tea, or energy drinks may affect some medicines. Use moderately.', 'caffeine', 2),
('a1b2c3d4-e5f6-7890-abcd-ef1234567892', '按时按量用药，不要自行增减或停药。', 'Take medicines on time and as directed. Do not change or stop them yourself.', 'timing', 3),
('a1b2c3d4-e5f6-7890-abcd-ef1234567893', '药品请置于阴凉干燥处，避免儿童接触。', 'Store medicines in a cool, dry place and keep them away from children.', 'storage', 4),
('a1b2c3d4-e5f6-7890-abcd-ef1234567894', '服药期间避免驾驶或操作危险机械，除非确认药物不影响反应能力。', 'Avoid driving or operating hazardous machinery after taking medicines unless you are sure they do not affect your alertness.', 'driving', 5),
('a1b2c3d4-e5f6-7890-abcd-ef1234567895', '孕期或哺乳期用药前，请先咨询医生或药师。', 'If you are pregnant or breastfeeding, consult a doctor or pharmacist before taking any medicine.', 'pregnancy', 6),
('a1b2c3d4-e5f6-7890-abcd-ef1234567896', '抗生素请按完整疗程服用，即使症状好转也不要提前停药。', 'Finish the full course of antibiotics even if you feel better. Do not stop early.', 'timing', 7),
('a1b2c3d4-e5f6-7890-abcd-ef1234567897', '如果曾经对某种药物过敏，再次使用前务必告知医生或药师。', 'If you have ever had an allergic reaction to a medicine, tell your doctor or pharmacist before using it again.', 'allergy', 8),
('a1b2c3d4-e5f6-7890-abcd-ef1234567898', '多种药物同时服用时，注意相互作用，必要时咨询专业人士。', 'When taking several medicines together, be aware of interactions and ask a professional if needed.', 'timing', 9),
('a1b2c3d4-e5f6-7890-abcd-ef1234567899', '不要用茶水、牛奶或果汁送服药物，除非说明书明确允许。', 'Do not take medicine with tea, milk, or juice unless the instructions say it is okay.', 'food', 10),
('a1b2c3d4-e5f6-7890-abcd-ef1234567900', '过期药品请勿服用，并按要求妥善处理。', 'Do not take expired medicines and dispose of them according to local guidelines.', 'storage', 11),
('a1b2c3d4-e5f6-7890-abcd-ef1234567901', '忘记服药时，通常不要加倍补服，具体请参照说明书或咨询药师。', 'If you miss a dose, do not usually double up. Check the instructions or ask a pharmacist.', 'timing', 12)
ON CONFLICT ("id") DO NOTHING;

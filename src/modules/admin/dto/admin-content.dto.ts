import { z } from 'zod';

const optionalLegalFields = {
  titleZh: z.string().trim().min(1).max(200).optional(),
  titleEn: z.string().trim().min(1).max(200).optional(),
  contentZh: z.string().min(1).max(500_000).optional(),
  contentEn: z.string().min(1).max(500_000).optional(),
  isActive: z.boolean().optional(),
};

export const adminLegalDocumentUpdateSchema = z
  .object(optionalLegalFields)
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type AdminLegalDocumentUpdateDto = z.infer<
  typeof adminLegalDocumentUpdateSchema
>;

export const adminLegalDocumentSchema = z
  .object({
    docType: z.string().meta({ example: 'terms-of-service' }),
    titleZh: z.string().meta({ example: '用户服务协议' }),
    titleEn: z.string().meta({ example: 'Terms of Service' }),
    contentZh: z.string(),
    contentEn: z.string(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const adminLegalDocumentListSchema = z.array(adminLegalDocumentSchema);

const safetyTipFields = {
  contentZh: z.string().trim().min(1).max(10_000),
  contentEn: z.string().trim().min(1).max(10_000),
  category: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
};

export const adminSafetyTipCreateSchema = z.object(safetyTipFields).strict();
export type AdminSafetyTipCreateDto = z.infer<
  typeof adminSafetyTipCreateSchema
>;

export const adminSafetyTipUpdateSchema = z
  .object({
    contentZh: safetyTipFields.contentZh.optional(),
    contentEn: safetyTipFields.contentEn.optional(),
    category: safetyTipFields.category.optional(),
    sortOrder: safetyTipFields.sortOrder.optional(),
    isActive: safetyTipFields.isActive.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type AdminSafetyTipUpdateDto = z.infer<
  typeof adminSafetyTipUpdateSchema
>;

export const adminSafetyTipSchema = z
  .object({
    id: z.uuid().meta({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    contentZh: z.string(),
    contentEn: z.string(),
    category: z.string().meta({ example: 'dosage' }),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const adminSafetyTipListSchema = z.array(adminSafetyTipSchema);

export const adminQaChunkListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().min(1).max(200).optional(),
    safetyLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type AdminQaChunkListQueryDto = z.infer<
  typeof adminQaChunkListQuerySchema
>;

const qaChunkFields = {
  question: z.string().trim().min(1).max(5_000),
  // The corpus is machine-translated prose with no editorial length ceiling
  // upstream (`MIN_ANSWER_LENGTH` in the import script is a floor, not a cap);
  // the bound here only rejects a pathological payload.
  answer: z.string().trim().min(1).max(500_000),
  safetyLabel: z.string().trim().min(1).max(80),
};

/**
 * `qaId` is excluded on purpose: it is the corpus identity assigned by the
 * import script, and the retrieval index names each document `qa:<qaId>:0`.
 */
export const adminQaChunkUpdateSchema = z
  .object({
    question: qaChunkFields.question.optional(),
    answer: qaChunkFields.answer.optional(),
    safetyLabel: qaChunkFields.safetyLabel.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type AdminQaChunkUpdateDto = z.infer<typeof adminQaChunkUpdateSchema>;

export const adminQaChunkSchema = z
  .object({
    id: z.uuid().meta({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    qaId: z.string().meta({ example: 'Q-1' }),
    question: z.string(),
    answer: z.string(),
    safetyLabel: z.string().meta({ example: 'general' }),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const adminQaChunkListResponseSchema = z
  .object({
    items: z.array(adminQaChunkSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
  })
  .strict();

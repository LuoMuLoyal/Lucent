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
    docType: z.string(),
    titleZh: z.string(),
    titleEn: z.string(),
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
    id: z.uuid(),
    contentZh: z.string(),
    contentEn: z.string(),
    category: z.string(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const adminSafetyTipListSchema = z.array(adminSafetyTipSchema);

import { z } from 'zod';

export const adminMetricsOverviewResponseSchema = z
  .object({
    generatedAt: z.iso.datetime().meta({
      example: '2026-01-15T08:30:00.000Z',
    }),
    users: z.object({
      total: z.number().int().nonnegative().meta({ example: 1280 }),
      active: z.number().int().nonnegative().meta({ example: 1150 }),
      suspended: z.number().int().nonnegative(),
      newLast30Days: z.number().int().nonnegative(),
    }),
    productEventsLast24Hours: z.number().int().nonnegative().meta({
      example: 4820,
    }),
  })
  .strict();

export type AdminMetricsOverviewDto = z.infer<
  typeof adminMetricsOverviewResponseSchema
>;

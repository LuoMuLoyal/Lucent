import { z } from 'zod';

export const adminMetricsOverviewResponseSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    users: z.object({
      total: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      suspended: z.number().int().nonnegative(),
      newLast30Days: z.number().int().nonnegative(),
    }),
    productEventsLast24Hours: z.number().int().nonnegative(),
  })
  .strict();

export type AdminMetricsOverviewDto = z.infer<
  typeof adminMetricsOverviewResponseSchema
>;

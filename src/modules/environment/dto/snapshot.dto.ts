import { z } from 'zod';

/**
 * Environment snapshot response schemas.
 *
 * The static reference snapshot is keyed by latitude band. All indicator
 * blocks are always present; unobserved optional readings surface as explicit
 * `null` values rather than omitted keys.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix). The enum constant arrays and their union
 * types below are kept unchanged.
 */

export const ENVIRONMENT_DATA_SOURCES = ['static', 'live'] as const;
export type EnvironmentDataSource = (typeof ENVIRONMENT_DATA_SOURCES)[number];

export const POLLEN_LEVELS = ['low', 'medium', 'high'] as const;
export type PollenLevel = (typeof POLLEN_LEVELS)[number];

export const UV_LEVELS = [
  'low',
  'moderate',
  'high',
  'very_high',
  'extreme',
] as const;
export type UvLevel = (typeof UV_LEVELS)[number];

export const AIR_QUALITY_LEVELS = [
  'good',
  'moderate',
  'unhealthy_sensitive',
  'unhealthy',
  'very_unhealthy',
  'hazardous',
] as const;
export type AirQualityLevel = (typeof AIR_QUALITY_LEVELS)[number];

/** Replaces `PollenIndicatorDto`. */
export const pollenIndicatorSchema = z.object({
  level: z.enum(POLLEN_LEVELS),
  primaryType: z.string().nullable(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
});

/** Strongly typed pollen indicator block of the environment snapshot. */
export type PollenIndicatorDto = z.infer<typeof pollenIndicatorSchema>;

/** Replaces `UvIndicatorDto`. */
export const uvIndicatorSchema = z.object({
  index: z.number(),
  level: z.enum(UV_LEVELS),
});

/** Strongly typed UV indicator block of the environment snapshot. */
export type UvIndicatorDto = z.infer<typeof uvIndicatorSchema>;

/** Replaces `AirQualityIndicatorDto`. */
export const airQualityIndicatorSchema = z.object({
  aqi: z.number(),
  level: z.enum(AIR_QUALITY_LEVELS),
  primaryPollutant: z.string().nullable(),
});

/** Strongly typed air-quality indicator block of the environment snapshot. */
export type AirQualityIndicatorDto = z.infer<typeof airQualityIndicatorSchema>;

/** Replaces `TemperatureIndicatorDto`. */
export const temperatureIndicatorSchema = z.object({
  celsius: z.number(),
  feelsLike: z.number(),
});

/** Strongly typed temperature indicator block of the environment snapshot. */
export type TemperatureIndicatorDto = z.infer<
  typeof temperatureIndicatorSchema
>;

/** Replaces `HumidityIndicatorDto`. */
export const humidityIndicatorSchema = z.object({
  percent: z.number(),
});

/** Strongly typed humidity indicator block of the environment snapshot. */
export type HumidityIndicatorDto = z.infer<typeof humidityIndicatorSchema>;

/**
 * Replaces the former `@ApiProperty` response class `EnvironmentSnapshotDto`.
 */
export const environmentSnapshotSchema = z.object({
  dataSource: z.enum(ENVIRONMENT_DATA_SOURCES),
  updatedAt: z
    .string()
    .describe('ISO-8601 timestamp for the static reference data refresh.'),
  regionHint: z.string().nullable(),
  pollen: pollenIndicatorSchema,
  uv: uvIndicatorSchema,
  airQuality: airQualityIndicatorSchema,
  temperature: temperatureIndicatorSchema,
  humidity: humidityIndicatorSchema,
});

/** Strongly typed environment snapshot data payload. */
export type EnvironmentSnapshotDto = z.infer<typeof environmentSnapshotSchema>;

/**
 * Response schema of `GET /environment/snapshot` — wire-identical to
 * {@link environmentSnapshotSchema}. Replaces the former response class
 * `EnvironmentSnapshotResponseDto` (which extended `EnvironmentSnapshotDto`
 * without adding fields).
 */
export const environmentSnapshotResponseSchema = environmentSnapshotSchema;

/** Strongly typed environment snapshot response body. */
export type EnvironmentSnapshotResponseDto = z.infer<
  typeof environmentSnapshotResponseSchema
>;

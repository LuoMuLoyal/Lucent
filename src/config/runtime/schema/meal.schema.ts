/**
 * Meal-analysis family: stale-job reaping schedule and batch sizes.
 *
 * Baselines mirror `modules/daily-records/constants/meal-analysis.constants.ts`.
 * The vision model timeout lives in the AI family (`AI_VISION_TIMEOUT_MS`); it
 * is the same knob the vision service passes to the model.
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import { cronField, numberField, type RuntimeFieldSpec } from './field-spec.js';

const MIN_STALE_AFTER_MS = 60_000;
const MAX_STALE_AFTER_MS = 86_400_000;

export const mealRuntimeFields = {
  [EnvKey.MEAL_ANALYSIS_STALE_AFTER_MS]: numberField({
    family: 'meal',
    min: MIN_STALE_AFTER_MS,
    max: MAX_STALE_AFTER_MS,
    defaultValue: 600_000,
  }),
  [EnvKey.MEAL_ANALYSIS_REAP_BATCH_SIZE]: numberField({
    family: 'meal',
    min: 1,
    max: 5_000,
    defaultValue: 200,
  }),
  [EnvKey.MEAL_ANALYSIS_REAP_CRON]: cronField({
    family: 'meal',
    defaultValue: '*/5 * * * *',
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;

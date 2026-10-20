/**
 * Queue family: per-queue worker concurrency plus the mail queue's retry and
 * retention policy.
 *
 * One concurrency key per queue in `common/queue/queue-names.ts`. The mail queue
 * keeps its own name because `MAIL_QUEUE_WORKER_CONCURRENCY` already exists and
 * is the key operators know. Concurrency changes are applied to the running
 * worker; the mail retry/retention values are read when a job is enqueued, so
 * queued jobs keep the policy they were created with.
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import { numberField, type RuntimeFieldSpec } from './field-spec.js';

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;

const MAIL_MIN_ATTEMPTS = 1;
const MAIL_MAX_ATTEMPTS = 20;
const MAIL_MIN_BACKOFF_MS = 100;
const MAIL_MAX_BACKOFF_MS = 3_600_000;
const MIN_RETENTION_SECONDS = 60;
const MAX_RETENTION_SECONDS = 31_536_000;
const MAX_RETENTION_COUNT = 1_000_000;

export const queueRuntimeFields = {
  [EnvKey.QUEUE_CRON_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 2,
  }),
  [EnvKey.QUEUE_REMINDER_DISPATCH_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_MEAL_ANALYSIS_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_DATA_EXPORT_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_MEDICINE_RECOGNITION_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_TODAY_ANALYSIS_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_CLINIC_SUMMARY_PDF_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),
  [EnvKey.QUEUE_REPORT_SUMMARY_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 2,
  }),
  [EnvKey.QUEUE_SUGGESTION_COPY_GENERATION_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 3,
  }),
  [EnvKey.QUEUE_SUGGESTION_EXPLANATION_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 2,
  }),
  [EnvKey.QUEUE_SUGGESTION_RECOMPUTE_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: MAX_CONCURRENCY,
    defaultValue: 1,
  }),

  [EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY]: numberField({
    family: 'queue',
    min: MIN_CONCURRENCY,
    max: 50,
    defaultValue: 3,
  }),
  [EnvKey.MAIL_QUEUE_MAX_ATTEMPTS]: numberField({
    family: 'queue',
    min: MAIL_MIN_ATTEMPTS,
    max: MAIL_MAX_ATTEMPTS,
    defaultValue: 3,
  }),
  [EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS]: numberField({
    family: 'queue',
    min: MAIL_MIN_BACKOFF_MS,
    max: MAIL_MAX_BACKOFF_MS,
    defaultValue: 5_000,
  }),
  [EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS]: numberField({
    family: 'queue',
    min: MIN_RETENTION_SECONDS,
    max: MAX_RETENTION_SECONDS,
    defaultValue: 86_400,
  }),
  [EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS]: numberField({
    family: 'queue',
    min: MIN_RETENTION_SECONDS,
    max: MAX_RETENTION_SECONDS,
    defaultValue: 604_800,
  }),
  [EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT]: numberField({
    family: 'queue',
    min: 1,
    max: MAX_RETENTION_COUNT,
    defaultValue: 1_000,
  }),
  [EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT]: numberField({
    family: 'queue',
    min: 1,
    max: MAX_RETENTION_COUNT,
    defaultValue: 5_000,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;

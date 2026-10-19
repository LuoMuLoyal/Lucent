/**
 * Storage family: presigned-URL lifetimes, upload ceilings and the object
 * identity (bucket/region/public base URL) each provider signs with.
 *
 * Credentials are deliberately absent — they stay in `.env` and never enter the
 * configuration center (§2 of the plan). Changing `bucket` or `region` only
 * affects URLs signed from that moment on; objects already stored keep the URL
 * they were given.
 *
 * Baselines mirror `config/app-defaults.constants.ts` and the per-provider
 * defaults in `environment.validation.ts`.
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import {
  nullableStringField,
  numberField,
  type RuntimeFieldSpec,
} from './field-spec.js';

const HTTP_URL = (value: string): string | null =>
  /^https?:\/\/\S+$/u.test(value) ? null : 'must be an http or https URL';

const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 3_600;
const DEFAULT_EXPIRES_SECONDS = 600;
const MAX_UPLOAD_BYTES = 50_000_000;
const DEFAULT_MAX_UPLOAD_BYTES = 10_485_760;

export const storageRuntimeFields = {
  // ── Tencent COS ───────────────────────────────────────────────────
  [EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES]: numberField({
    family: 'storage',
    min: 1,
    max: MAX_UPLOAD_BYTES,
    defaultValue: DEFAULT_MAX_UPLOAD_BYTES,
  }),
  [EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]: nullableStringField({
    family: 'storage',
    validate: HTTP_URL,
  }),
  [EnvKey.TENCENT_COS_BUCKET]: nullableStringField({ family: 'storage' }),
  [EnvKey.TENCENT_COS_REGION]: nullableStringField({
    family: 'storage',
    defaultValue: 'ap-guangzhou',
  }),

  // ── Aliyun OSS ────────────────────────────────────────────────────
  [EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES]: numberField({
    family: 'storage',
    min: 1,
    max: MAX_UPLOAD_BYTES,
    defaultValue: DEFAULT_MAX_UPLOAD_BYTES,
  }),
  [EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL]: nullableStringField({
    family: 'storage',
    validate: HTTP_URL,
  }),
  [EnvKey.ALIYUN_OSS_BUCKET]: nullableStringField({ family: 'storage' }),
  [EnvKey.ALIYUN_OSS_REGION]: nullableStringField({
    family: 'storage',
    defaultValue: 'oss-cn-hangzhou',
  }),

  // ── S3-compatible (dev: SeaweedFS) ────────────────────────────────
  [EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES]: numberField({
    family: 'storage',
    min: 1,
    max: MAX_UPLOAD_BYTES,
    defaultValue: DEFAULT_MAX_UPLOAD_BYTES,
  }),
  [EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS]: numberField({
    family: 'storage',
    min: MIN_EXPIRES_SECONDS,
    max: MAX_EXPIRES_SECONDS,
    defaultValue: DEFAULT_EXPIRES_SECONDS,
  }),
  [EnvKey.STORAGE_S3_PUBLIC_BASE_URL]: nullableStringField({
    family: 'storage',
    validate: HTTP_URL,
  }),
  [EnvKey.STORAGE_S3_BUCKET]: nullableStringField({ family: 'storage' }),
  [EnvKey.STORAGE_S3_REGION]: nullableStringField({
    family: 'storage',
    defaultValue: 'us-east-1',
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;

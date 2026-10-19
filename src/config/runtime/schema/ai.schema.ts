/**
 * AI family: per-role model/endpoint/thinking plus sampling knobs and prompt
 * overrides.
 *
 * Baselines mirror the current code constants:
 *
 * - `vision` is the only role that today passes `temperature`/`maxRetries`/
 *   `timeout` explicitly (`services/meal-analysis/vision.service.ts`), so it is
 *   the only one with numeric baselines. The other roles default to `null`,
 *   which means "leave the provider default alone".
 * - Prompt keys default to `null` = "use the code prompt"; the baseline text
 *   lives in the prompt modules, not here (see `prompt-registry.ts`).
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import {
  enumField,
  nullableNumberField,
  nullableStringField,
  promptField,
  type RuntimeFieldSpec,
} from './field-spec.js';

const HTTP_URL = (value: string): string | null =>
  /^https?:\/\/\S+$/u.test(value) ? null : 'must be an http or https URL';

const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const MIN_RETRIES = 0;
const MAX_RETRIES = 5;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

const MEAL_ANALYSIS_VISION_TIMEOUT_MS = 20_000;

const THINKING_MODES = ['auto', 'enabled', 'disabled'] as const;

type ThinkingMode = (typeof THINKING_MODES)[number];

function isThinkingMode(value: string | undefined): value is ThinkingMode {
  return THINKING_MODES.some((mode) => mode === value);
}

/**
 * Baseline thinking mode for a role: role-level env override, else the global
 * `AI_THINKING`, else `auto`. Mirrors `buildRoleConfig` in
 * `services/llm.config.ts` so the two cannot disagree about the baseline.
 */
function thinkingBaseline(roleKey: EnvKey): () => ThinkingMode {
  return () => {
    const own = process.env[roleKey]?.trim().toLowerCase();
    if (isThinkingMode(own)) {
      return own;
    }
    const global = process.env[EnvKey.AI_THINKING]?.trim().toLowerCase();
    return isThinkingMode(global) ? global : 'auto';
  };
}

export const aiRuntimeFields = {
  // ── Per-role endpoint and model ────────────────────────────────────
  [EnvKey.AI_ANALYSIS_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_ANALYSIS_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),
  [EnvKey.AI_ANALYSIS_THINKING]: enumField({
    family: 'ai',
    values: THINKING_MODES,
    defaultValue: thinkingBaseline(EnvKey.AI_ANALYSIS_THINKING),
  }),
  [EnvKey.AI_VISION_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_VISION_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),
  [EnvKey.AI_VISION_THINKING]: enumField({
    family: 'ai',
    values: THINKING_MODES,
    defaultValue: thinkingBaseline(EnvKey.AI_VISION_THINKING),
  }),
  [EnvKey.AI_LANGUAGE_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_LANGUAGE_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),
  [EnvKey.AI_LANGUAGE_THINKING]: enumField({
    family: 'ai',
    values: THINKING_MODES,
    defaultValue: thinkingBaseline(EnvKey.AI_LANGUAGE_THINKING),
  }),
  [EnvKey.AI_CHAT_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_CHAT_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),
  [EnvKey.AI_CHAT_THINKING]: enumField({
    family: 'ai',
    values: THINKING_MODES,
    defaultValue: thinkingBaseline(EnvKey.AI_CHAT_THINKING),
  }),
  [EnvKey.AI_CHAT_COMPRESSION_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_CHAT_COMPRESSION_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),
  [EnvKey.AI_CHAT_COMPRESSION_THINKING]: enumField({
    family: 'ai',
    values: THINKING_MODES,
    defaultValue: thinkingBaseline(EnvKey.AI_CHAT_COMPRESSION_THINKING),
  }),
  [EnvKey.AI_EMBEDDING_MODEL]: nullableStringField({ family: 'ai' }),
  [EnvKey.AI_EMBEDDING_BASE_URL]: nullableStringField({
    family: 'ai',
    validate: HTTP_URL,
  }),

  // ── Per-role sampling / retry / timeout ────────────────────────────
  [EnvKey.AI_ANALYSIS_TEMPERATURE]: nullableNumberField({
    family: 'ai',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
    integer: false,
  }),
  [EnvKey.AI_ANALYSIS_MAX_RETRIES]: nullableNumberField({
    family: 'ai',
    min: MIN_RETRIES,
    max: MAX_RETRIES,
  }),
  [EnvKey.AI_ANALYSIS_TIMEOUT_MS]: nullableNumberField({
    family: 'ai',
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
  }),
  [EnvKey.AI_VISION_TEMPERATURE]: nullableNumberField({
    family: 'ai',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
    integer: false,
    defaultValue: 0.1,
  }),
  [EnvKey.AI_VISION_MAX_RETRIES]: nullableNumberField({
    family: 'ai',
    min: MIN_RETRIES,
    max: MAX_RETRIES,
    defaultValue: 0,
  }),
  [EnvKey.AI_VISION_TIMEOUT_MS]: nullableNumberField({
    family: 'ai',
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
    defaultValue: MEAL_ANALYSIS_VISION_TIMEOUT_MS,
  }),
  [EnvKey.AI_LANGUAGE_TEMPERATURE]: nullableNumberField({
    family: 'ai',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
    integer: false,
  }),
  [EnvKey.AI_LANGUAGE_MAX_RETRIES]: nullableNumberField({
    family: 'ai',
    min: MIN_RETRIES,
    max: MAX_RETRIES,
  }),
  [EnvKey.AI_LANGUAGE_TIMEOUT_MS]: nullableNumberField({
    family: 'ai',
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
  }),
  [EnvKey.AI_CHAT_TEMPERATURE]: nullableNumberField({
    family: 'ai',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
    integer: false,
  }),
  [EnvKey.AI_CHAT_MAX_RETRIES]: nullableNumberField({
    family: 'ai',
    min: MIN_RETRIES,
    max: MAX_RETRIES,
  }),
  [EnvKey.AI_CHAT_TIMEOUT_MS]: nullableNumberField({
    family: 'ai',
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
  }),
  [EnvKey.AI_CHAT_COMPRESSION_TEMPERATURE]: nullableNumberField({
    family: 'ai',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
    integer: false,
  }),
  [EnvKey.AI_CHAT_COMPRESSION_MAX_RETRIES]: nullableNumberField({
    family: 'ai',
    min: MIN_RETRIES,
    max: MAX_RETRIES,
  }),
  [EnvKey.AI_CHAT_COMPRESSION_TIMEOUT_MS]: nullableNumberField({
    family: 'ai',
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS,
  }),

  // ── Safety policy ─────────────────────────────────────────────────
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]: {
    family: 'ai',
    defaultValue: [] as string[],
    parse: (raw: string) => {
      const patterns = raw
        .split(/[,\n]/u)
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0);
      return patterns.length > 0
        ? { ok: true as const, value: patterns }
        : {
            ok: false as const,
            message: 'must contain at least one pattern',
          };
    },
  } satisfies RuntimeFieldSpec<string[]>,

  // ── Prompt overrides ──────────────────────────────────────────────
  // Markers are the variable parts of the code-side builder; an override that
  // drops one would lose data the caller cannot re-derive.
  [EnvKey.PROMPT_ASSISTANT_SYSTEM]: promptField({
    family: 'ai',
    placeholders: ['tools', 'toolAvailability'],
  }),
  [EnvKey.PROMPT_INTENT_ROUTER]: promptField({
    family: 'ai',
    placeholders: [],
  }),
  [EnvKey.PROMPT_MEAL_ANALYSIS_SYSTEM]: promptField({
    family: 'ai',
    placeholders: ['language'],
  }),
  [EnvKey.PROMPT_MEAL_ANALYSIS_USER]: promptField({
    family: 'ai',
    placeholders: ['language'],
  }),
  [EnvKey.PROMPT_RISK_CHECK]: promptField({ family: 'ai', placeholders: [] }),
  [EnvKey.PROMPT_REPORT_SUMMARY]: promptField({
    family: 'ai',
    placeholders: [],
  }),
  [EnvKey.PROMPT_TODAY_ANALYSIS]: promptField({
    family: 'ai',
    placeholders: [],
  }),
  [EnvKey.PROMPT_SUGGESTION_COPY]: promptField({
    family: 'ai',
    placeholders: ['tone'],
  }),
  [EnvKey.PROMPT_SUGGESTION_EXPLANATION]: promptField({
    family: 'ai',
    placeholders: [],
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;

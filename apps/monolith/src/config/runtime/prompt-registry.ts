/**
 * Prompt overrides published through the configuration center.
 *
 * The registry is the single declaration of what exists: which prompt each
 * document key replaces, which placeholders the caller must supply, and how the
 * text is fingerprinted for logs. It deliberately does not import the prompt
 * modules — they live in feature modules and own their wording, so each caller
 * passes the code prompt as `baseline`. "No override" therefore behaves exactly
 * as it did before this layer existed.
 *
 * Validation of the published text (length cap, required placeholders) happens
 * when the document is parsed, not here: a prompt that drops a placeholder is
 * rejected as a whole document (`promptField` in `schema/field-spec.ts`). This
 * module only performs the substitution, and treats a missing value as "fall
 * back to the code prompt" so a literal `{{language}}` can never reach a model.
 */

import { createHash } from 'node:crypto';
import { EnvKey } from '../env/env-keys.enum.js';
import type { RuntimeConfigKey } from './runtime-config.schema.js';
import type { RuntimeConfigPort } from './runtime-config.types.js';

export interface RuntimePromptSpec {
  /** Document key whose value replaces the code prompt. */
  readonly key: RuntimeConfigKey;
  /** Markers the caller must supply; the document must keep every one of them. */
  readonly placeholders: readonly string[];
}

export const RUNTIME_PROMPT_SPECS = {
  assistantSystem: {
    key: EnvKey.PROMPT_ASSISTANT_SYSTEM,
    placeholders: ['tools', 'toolAvailability'],
  },
  intentRouter: {
    key: EnvKey.PROMPT_INTENT_ROUTER,
    placeholders: [],
  },
  mealAnalysisSystem: {
    key: EnvKey.PROMPT_MEAL_ANALYSIS_SYSTEM,
    placeholders: ['language'],
  },
  mealAnalysisUser: {
    key: EnvKey.PROMPT_MEAL_ANALYSIS_USER,
    placeholders: ['language'],
  },
  riskCheck: {
    key: EnvKey.PROMPT_RISK_CHECK,
    placeholders: [],
  },
  reportSummary: {
    key: EnvKey.PROMPT_REPORT_SUMMARY,
    placeholders: [],
  },
  todayAnalysis: {
    key: EnvKey.PROMPT_TODAY_ANALYSIS,
    placeholders: [],
  },
  suggestionCopy: {
    key: EnvKey.PROMPT_SUGGESTION_COPY,
    placeholders: ['tone'],
  },
  suggestionExplanation: {
    key: EnvKey.PROMPT_SUGGESTION_EXPLANATION,
    placeholders: [],
  },
} as const satisfies Record<string, RuntimePromptSpec>;

export type RuntimePromptName = keyof typeof RUNTIME_PROMPT_SPECS;

/** Exactly the values the named prompt declares; `{}` when it declares none. */
export type RuntimePromptPlaceholders<Name extends RuntimePromptName> =
  Readonly<
    Record<(typeof RUNTIME_PROMPT_SPECS)[Name]['placeholders'][number], string>
  >;

export const RUNTIME_PROMPT_KEYS = Object.values(RUNTIME_PROMPT_SPECS).map(
  (spec) => spec.key,
);

/** The part of the snapshot service this module needs. */
export type RuntimePromptSource = Pick<RuntimeConfigPort, 'getSnapshot'>;

/**
 * Returns the prompt in force for `name`: the published text with its
 * placeholders filled, or `baseline()` when nothing is published.
 */
export function resolveRuntimePrompt<Name extends RuntimePromptName>(
  source: RuntimePromptSource | undefined,
  name: Name,
  baseline: () => string,
  placeholders: RuntimePromptPlaceholders<Name>,
): string {
  const spec: RuntimePromptSpec = RUNTIME_PROMPT_SPECS[name];
  const template = source?.getSnapshot().values[spec.key];
  if (typeof template !== 'string') {
    return baseline();
  }
  return renderPrompt(template, spec.placeholders, placeholders) ?? baseline();
}

function renderPrompt(
  template: string,
  names: readonly string[],
  values: Readonly<Record<string, string>>,
): string | null {
  let text = template;
  for (const name of names) {
    const value = values[name];
    if (typeof value !== 'string') {
      return null;
    }
    text = text.replaceAll(`{{${name}}}`, value);
  }
  return text;
}

const FINGERPRINT_LENGTH = 12;

/**
 * Short, stable fingerprint of prompt text for logs.
 *
 * Operators need to tell two revisions apart; the model instructions
 * themselves must not end up in log storage, so only this digest is logged.
 */
export function fingerprintPrompt(text: string): string {
  return createHash('sha256')
    .update(text)
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

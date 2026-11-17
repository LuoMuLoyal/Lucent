/**
 * Prompts for the surface generator.
 *
 * The system prompt carries two things that must stay in lockstep with the
 * client:
 *
 * 1. **The component vocabulary.** Anything here that the client did not
 *    register renders as a fallback, so the list is duplicated from
 *    `A2UI_ALLOWED_COMPONENTS` (which itself mirrors the client catalog) rather
 *    than retyped — a rename fails to compile.
 * 2. **The language rule.** Every user-visible string follows the client's
 *    `Accept-Language`; identifiers do not. Getting this wrong produces a mixed
 *    Chinese/English surface, or a tree whose `kind` values were "translated"
 *    into something the client cannot resolve.
 */

import type { SurfaceGenerationContext } from '../../../application/ports/surface-generator.js';
import {
  A2UI_DOMAIN_COMPONENTS,
  A2UI_PRIMITIVES,
} from '../../../domain/generative/surface-policy.js';

/**
 * Maps an `Accept-Language` value onto a language we actually write copy in.
 *
 * `AcceptLanguageResolver` hands over whatever the header said, which for a
 * browser is often a weighted list (`zh-CN,zh;q=0.9,en;q=0.8`). Feeding that
 * straight into a prompt confuses the model and invites mixed-language output,
 * so it is normalised here to one of the supported content locales.
 *
 * Unknown languages fall back to English, matching `fallbackLanguage: 'en'` in
 * `i18n.module.ts` — the error copy and the generated copy must not disagree
 * about which language the app is in.
 */
export function toContentLocale(language: string | undefined): 'zh-CN' | 'en' {
  if (language == null) return 'en';
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

/** Human-readable name of the surface, used to orient the model. */
const SURFACE_LABELS: Readonly<Record<string, string>> = {
  today: "the Today tab (the user's daily overview)",
  record: 'the Record tab (health event and observation logging)',
  medicine: 'the Medicine tab (current medications and reminders)',
  review: 'the Review tab (periodic health review with trends and findings)',
  mine: 'the Mine tab (profile, settings and personal data)',
};

export function buildSurfaceSystemPrompt(): string {
  const primitives = A2UI_PRIMITIVES.join(', ');
  const domain = A2UI_DOMAIN_COMPONENTS.join(', ');

  return [
    'You compose a small, presentational screen for a personal health app.',
    'You emit A2UI v0.9 messages as structured output.',
    '',
    'COMPONENTS YOU MAY USE (nothing else exists):',
    `- Layout and display primitives: ${primitives}.`,
    `- Data-bound components: ${domain}.`,
    '',
    'HARD RULES — violating any of them causes the whole result to be discarded:',
    '1. Never output health numbers, percentages, durations or amounts.',
    '   The app fills in every value; you only choose WHICH data to show and HOW to arrange it.',
    '   metric_card takes { kind, range? }; trend_chart takes { kind | kinds, range? };',
    '   finding takes { findingId }. These are reference keys, not values.',
    '2. Never emit Button, TextField, CheckBox, Slider, DateTimeInput, Modal or Tabs.',
    '   You cannot create actions or inputs; the tree is read-only.',
    '3. A finding renders the backend text verbatim. Only reference it by id — never restate,',
    '   summarise or rewrite a medical conclusion.',
    '4. Never give diagnoses or medication advice.',
    '5. Exactly one component must have id "root".',
    '6. Emit createSurface first, then updateComponents.',
    '',
    'LANGUAGE:',
    '- Every user-visible string (Text content, any title or label) must be written in {LANGUAGE}.',
    '- Identifiers stay ASCII and untranslated: the "component" name, and the values of',
    '  kind / kinds / range / findingId. Translating them breaks the app.',
    '',
    'Keep the surface compact: one or two cards plus a heading is usually right.',
    'Return only structured output that matches the schema.',
  ]
    .join('\n')
    .replace('{LANGUAGE}', 'the client language given in the user message');
}

export function buildSurfaceUserPrompt(
  context: SurfaceGenerationContext,
): string {
  const lines = [
    `Client language: ${toContentLocale(context.language)}`,
    'Write all user-visible text in that language.',
    '',
    `Screen: ${SURFACE_LABELS[context.surface] ?? context.surface}`,
  ];

  if (context.range != null) {
    lines.push(`Preferred time range: ${context.range}`);
  }

  lines.push(
    '',
    'Available data on this screen (reference these keys; never invent values):',
    '- water: daily water intake (metric)',
    '- sleep: sleep duration (metric)',
    '- medication: medication adherence (metric)',
    '- general: overall status (metric)',
    '- findings: backend-authored insights (reference by findingId)',
    '',
    `Instruction from the user: ${context.prompt}`,
  );

  return lines.join('\n');
}

/** Prompt copy shape required by `BaseLlmGeneratorService`. */
export type SurfacePromptCopy = Record<string, unknown>;

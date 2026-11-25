/**
 * Prompts for the surface generator.
 *
 * ## A2UI 1.0: the vocabulary comes from the client
 *
 * Up to v0.9 this file hard-coded the component list, duplicating the client
 * catalog. In v1.0 the client advertises its catalog on every call
 * (`capabilities`), so the list here is **generated from that document**. Two
 * consequences worth knowing:
 *
 * 1. There is exactly one vocabulary across both repositories. Adding a component
 *    client-side needs no server release.
 * 2. The prompt can describe a catalog far larger than the old eight primitives
 *    (the v1.0 basic catalog ships Button, TextField, CheckBox, Slider,
 *    DateTimeInput, Tabs, Modal …), so it is structured rather than enumerated
 *    inline: name + description per component, and one section on actions.
 *
 * The language rule stays: every user-visible string follows the client's
 * `Accept-Language`; identifiers do not. Getting this wrong produces a mixed
 * Chinese/English surface, or a tree whose `kind` values were "translated" into
 * something the client cannot resolve.
 */

import type { SurfaceCapabilities } from '../../../domain/generative/generation-request.js';
import type {
  SurfaceGenerationContext,
  SurfaceTurnContext,
} from '../../../application/ports/surface-generator.js';

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

/**
 * Fallback vocabulary description, used when the client sent no capabilities.
 *
 * Deliberately vague: the server may not invent a component list, or it becomes
 * the second copy this version set out to delete. A client that sends none is
 * either ancient or a test, and either way the protocol section below is what
 * matters.
 */
const GENERIC_VOCABULARY =
  'The client advertises no catalog, so use only universally defined A2UI ' +
  'components: Row, Column, List, Card, Text, Divider, Icon, Image.';

export function buildSurfaceSystemPrompt(
  capabilities?: SurfaceCapabilities,
  catalogId?: string,
): string {
  return [
    'You compose a small, presentational screen for a personal health app.',
    'You emit A2UI v1.0 messages as structured output.',
    '',
    'COMPONENTS YOU MAY USE:',
    summariseCapabilities(capabilities),
    '',
    'PROTOCOL (A2UI v1.0):',
    '- Every message is one object: { "version": "1.0", <one body key> }.',
    '- Agent-to-renderer body keys: createSurface, updateComponents,',
    '  updateDataModel, deleteSurface, callRendererFunction, agentFunctionResponse.',
    '- createSurface carries { surfaceId, catalogId, sendDataModel?, components?,',
    '  dataModel? }. v1.0 may inline the whole tree and its data in it.',
    // The id is deployment config, never invented here. When a deployment names
    // none, the model is told to copy the client's id instead of making one up —
    // a made-up id does not resolve against the renderer's catalog.
    catalogId == null || catalogId.length === 0
      ? '- Use exactly the catalogId the client sent in its capabilities; never' +
        '\n  invent one.'
      : `- Use this catalogId verbatim in createSurface: ${catalogId}`,
    '- updateComponents carries { surfaceId, components: [...] } as a FLAT list;',
    '  parents name children by id. Exactly one component must have id "root".',
    '- Binding: a property that may be dynamic takes either a literal, or',
    '  { "@path": "/some/pointer" } to read the data model, or',
    '  { "@call": "name", args: {...} } to call a catalog function.',
    '- Writing back: an input component bound with "@path" writes into the data',
    '  model itself. Set sendDataModel: true on createSurface so the app can send',
    '  the current values back with the next action.',
    '- Actions: a component may carry an "action" object, either',
    '  { "event": { "name": "..." } } (a plain event to the agent) or',
    '  { "functionCall": { "@call": "..." } }. Buttons and inputs use it; the app',
    '  sends the action back and you continue the same surface.',
    '- Checks: "@checks" on an input component carries [{ condition, message }],',
    '  and the component reports validationErrors. Use it instead of inventing',
    '  your own error text.',
    '- Accessibility: "@accessibility" carries { label, description, live, hidden }',
    '  on any component.',
    '',
    'RULES:',
    '1. Use only components listed above. An unlisted component renders as a',
    '   fallback placeholder and the user sees nothing useful.',
    '2. Data-bound components take REFERENCE KEYS, not values: metric_card takes',
    '   { kind, range? }; trend_chart takes { kind | kinds, range? }; finding takes',
    '   { findingId }. The app fills in every number from its own state.',
    '3. A finding renders the backend text verbatim. Only reference it by id.',
    '4. Never give diagnoses or medication advice.',
    '5. Emit createSurface before anything that targets that surface.',
    '6. Keep property names ASCII and exactly as listed: "component" names and the',
    '   values of kind / kinds / range / findingId are identifiers, not copy.',
    '',
    'LANGUAGE:',
    '- Every user-visible string (Text content, labels, check messages) must be',
    '  written in {LANGUAGE}.',
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

/**
 * User prompt for one continuation round.
 *
 * The document is echoed back in full because the agent has no session: it must
 * see the surface the action fired from to continue it rather than replace it.
 */
export function buildSurfaceTurnUserPrompt(
  context: SurfaceTurnContext,
): string {
  const lines = [
    `Client language: ${toContentLocale(context.language)}`,
    'Write all user-visible text in that language.',
    '',
    `Screen: ${SURFACE_LABELS[context.surface] ?? context.surface}`,
    '',
    'The app is showing this A2UI surface. Current document (JSON):',
    JSON.stringify(
      {
        messages: context.document.messages,
        ...(context.document.dataModel == null
          ? {}
          : { dataModel: context.document.dataModel }),
      },
      null,
      2,
    ),
    '',
    'The user just interacted with it. Renderer-to-agent messages (JSON):',
    JSON.stringify(context.messages, null, 2),
    '',
    'Continue the same surface: reply with the COMPLETE message sequence that',
    'should be shown now (createSurface included), reflecting the interaction.',
    'Do not reply with a diff, and do not start a different screen.',
  ];

  return lines.join('\n');
}

/**
 * Renders the client catalog document as prompt text.
 *
 * The document is the v1.0 catalog shape: `{ catalogId, components: { name:
 * { description?, ... } }, functions?: {...} }`, optionally wrapped per protocol
 * version as `{ "1.0": { supportedCatalogIds, inlineCatalogs } }`.
 *
 * Descriptions come from the client, so this only formats — it never adds
 * knowledge the client did not send.
 */
function summariseCapabilities(capabilities?: SurfaceCapabilities): string {
  if (capabilities == null) return GENERIC_VOCABULARY;

  const catalogs = collectCatalogs(capabilities);
  if (catalogs.length === 0) return GENERIC_VOCABULARY;

  const lines: string[] = [];
  for (const catalog of catalogs) {
    const id =
      typeof catalog['catalogId'] === 'string' ? catalog['catalogId'] : '';
    if (id.length > 0) lines.push(`Catalog: ${id}`);

    const components = catalog['components'];
    if (components != null && typeof components === 'object') {
      for (const [name, definition] of Object.entries(
        components as Record<string, unknown>,
      )) {
        lines.push(`- ${name}${describeComponent(definition)}`);
      }
    }

    const functions = catalog['functions'];
    if (functions != null && typeof functions === 'object') {
      const names = Object.keys(functions);
      if (names.length > 0) {
        lines.push(`Catalog functions: ${names.join(', ')}`);
      }
    }
  }

  // An inline catalog is whatever the client registered; if the shape was not
  // recognised we say so rather than teaching the model nothing at all.
  return lines.length === 0 ? GENERIC_VOCABULARY : lines.join('\n');
}

/**
 * Collects the catalog documents out of either shape v1.0 allows.
 *
 * - Flat: the catalog document itself (`{ catalogId, components }`).
 * - Versioned: `{ "1.0": { inlineCatalogs: [ <document>, ... ] } }`, which is
 *   what `getRendererCapabilities(...).toJson()` produces.
 */
function collectCatalogs(
  capabilities: SurfaceCapabilities,
): Record<string, unknown>[] {
  const inline: unknown[] = [];

  const collectFrom = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record['inlineCatalogs'])) {
      inline.push(...(record['inlineCatalogs'] as unknown[]));
      return;
    }
    if (record['components'] != null) {
      inline.push(record);
    }
  };

  collectFrom(capabilities);
  for (const value of Object.values(capabilities)) collectFrom(value);

  return inline.filter(
    (entry): entry is Record<string, unknown> =>
      entry != null && typeof entry === 'object' && !Array.isArray(entry),
  );
}

/** ` - <description>` for a component definition, or empty when it has none. */
function describeComponent(definition: unknown): string {
  if (definition == null || typeof definition !== 'object') return '';
  const description = (definition as Record<string, unknown>)['description'];
  if (typeof description !== 'string' || description.length === 0) return '';
  // Descriptions may be several sentences; the prompt wants one clause each.
  return ` — ${description.split(/(?<=\.)\s/)[0] ?? description}`;
}

/** Prompt copy shape required by `BaseLlmGeneratorService`. */
export type SurfacePromptCopy = Record<string, unknown>;

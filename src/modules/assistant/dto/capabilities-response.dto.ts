import { z } from 'zod';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_TOOL_DISABLED_REASONS,
  ASSISTANT_TOOL_NAMES,
} from '../tools/shared/tool-types.js';

/**
 * Standard Schema (zod 4) for one tool capability entry of
 * `GET /assistant/capabilities`. Replaces the former
 * `AssistantToolCapabilityDto` response class.
 */
export const assistantToolCapabilitySchema = z.object({
  name: z
    .enum(ASSISTANT_TOOL_NAMES)
    .describe('Stable tool identifier exposed to the client.'),
  requiredContextSources: z
    .array(z.enum(ASSISTANT_CONTEXT_SOURCES))
    .describe(
      `Context sources this tool requires before it may run. Allowed values: ${ASSISTANT_CONTEXT_SOURCES.join(', ')}.`,
    ),
  permittedByUser: z
    .boolean()
    .describe(
      'Whether the current user settings permit this tool in principle.',
    ),
  enabled: z
    .boolean()
    .describe('Whether this tool is currently executable for this user.'),
  implemented: z
    .boolean()
    .describe(
      'Whether the server has already implemented this tool beyond planning/foundation wiring.',
    ),
  disabledReason: z
    .enum(ASSISTANT_TOOL_DISABLED_REASONS)
    .nullable()
    .describe('Why the tool is currently disabled, or null when enabled.'),
});

/** Strongly typed single-tool capability entry. */
export type AssistantToolCapabilityDto = z.infer<
  typeof assistantToolCapabilitySchema
>;

/**
 * Standard Schema (zod 4) for the authenticated user assistant capabilities
 * and permissions returned by `GET /assistant/capabilities`. Replaces the
 * former `AssistantCapabilitiesDataDto` response class.
 */
export const assistantCapabilitiesDataSchema = z.object({
  phase: z
    .literal('foundation')
    .describe('Current backend rollout phase for the assistant.'),
  assistantEnabled: z
    .boolean()
    .describe('Whether the user has left the assistant enabled in settings.'),
  assistantMemoryEnabled: z
    .boolean()
    .describe(
      'Whether cross-conversation assistant memory reuse is enabled for this user.',
    ),
  assistantContext: z
    .object({
      healthProfile: z
        .boolean()
        .describe(
          'Whether the assistant may read stored health profile, allergies, and conditions.',
        ),
      dailyRecords: z
        .boolean()
        .describe('Whether the assistant may read recent daily records.'),
      sleepRecords: z
        .boolean()
        .describe(
          'Whether the assistant may read sleep records and summaries.',
        ),
      currentMedicines: z
        .boolean()
        .describe(
          'Whether the assistant may read current medicines and medicine-box data.',
        ),
    })
    .describe('Fine-grained assistant context permissions from user settings.'),
  chatModelConfigured: z
    .boolean()
    .describe('Whether the configured chat model role exists server-side.'),
  interactiveChatReady: z
    .boolean()
    .describe(
      'Whether an actual end-user chat interaction route is ready to be exposed.',
    ),
  langGraphReady: z
    .boolean()
    .describe('Whether the LangGraph orchestration foundation is active.'),
  streamingSupported: z
    .boolean()
    .describe('Whether the current backend intends to stream responses.'),
  streamingTransport: z
    .literal('sse')
    .describe('Recommended streaming transport for the current chat contract.'),
  markdownRenderingRecommended: z
    .boolean()
    .describe(
      'Whether the frontend should expect Markdown output and render it faithfully.',
    ),
  ragEnabled: z
    .boolean()
    .describe(
      'Whether medicine-leaflet retrieval augmentation is currently enabled.',
    ),
  tools: z
    .array(assistantToolCapabilitySchema)
    .describe(
      'Tool-by-tool capability breakdown after combining system state and user permissions.',
    ),
  updatedAt: z
    .string()
    .nullable()
    .describe('ISO-8601 timestamp of the latest related settings update.'),
});

/** Strongly typed assistant capabilities and permissions payload. */
export type AssistantCapabilitiesDataDto = z.infer<
  typeof assistantCapabilitiesDataSchema
>;

/**
 * Backwards-compatible response alias for `GET /assistant/capabilities`;
 * identical to {@link AssistantCapabilitiesDataDto} on the wire.
 */
export type AssistantCapabilitiesResponseDto = AssistantCapabilitiesDataDto;

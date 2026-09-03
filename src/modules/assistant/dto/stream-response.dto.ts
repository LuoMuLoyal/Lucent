import { z } from 'zod';
import { assistantProposedActionSchema } from './proposed-action.dto.js';

/**
 * Standard Schema (zod 4) for the client-facing projection of tool metadata
 * included in an assistant SSE result. Replaces the former
 * `AssistantToolDetailDto` response class, which deliberately differed from
 * the internal execution envelope.
 */
export const assistantToolDetailSchema = z.object({
  name: z.string().describe('Tool name used during generation.'),
  label: z
    .string()
    .nullable()
    .optional()
    .describe('Optional display subject, e.g. the resolved product name.'),
  coverage: z
    .object({
      status: z.enum(['complete', 'partial', 'empty']),
      reason: z.string().nullable(),
    })
    .nullish()
    .describe('Optional result envelope coverage.'),
  confidence: z
    .object({
      level: z.enum(['high', 'medium', 'low']),
      reason: z.string(),
    })
    .nullish()
    .describe('Optional result envelope confidence.'),
  ambiguities: z
    .array(z.string())
    .optional()
    .describe('Optional result envelope ambiguities.'),
  source: z
    .object({
      tool: z.string(),
      generatedAt: z.string(),
      tables: z.array(z.string()),
    })
    .nullish()
    .describe('Optional result envelope source meta.'),
  disclaimer: z
    .string()
    .nullable()
    .optional()
    .describe('Optional medical knowledge disclaimer from the tool result.'),
});

/** Strongly typed client-facing projection of tool metadata. */
export type AssistantToolDetailDto = z.infer<typeof assistantToolDetailSchema>;

/**
 * Standard Schema (zod 4) for an incremental assistant text chunk emitted as
 * an SSE event. Replaces the former `AssistantStreamChunkDto` response class.
 */
export const assistantStreamChunkSchema = z.object({
  content: z
    .string()
    .describe('Incremental assistant text chunk for SSE rendering.'),
});

/** Strongly typed assistant text chunk for SSE rendering. */
export type AssistantStreamChunkDto = z.infer<
  typeof assistantStreamChunkSchema
>;

/**
 * Standard Schema (zod 4) for the final assistant message data carried by an
 * SSE `result` event. Replaces the former `AssistantMessageDataDto` response
 * class.
 */
export const assistantMessageDataSchema = z.object({
  conversationId: z
    .string()
    .describe('Persisted conversation identifier for this assistant reply.'),
  role: z
    .literal('assistant')
    .describe('Final assistant role for the generated reply.'),
  content: z.string().describe('Full final Markdown-friendly assistant reply.'),
  usedTools: z
    .array(z.string())
    .describe(
      'Tool names actually used during generation. Allowed values follow the assistant tool contract.',
    ),
  generatedAt: z
    .string()
    .describe('ISO-8601 timestamp for the final assistant reply.'),
  proposedActions: z
    .array(assistantProposedActionSchema)
    .optional()
    .describe(
      'Optional proposal-only write intents that still require explicit client confirmation.',
    ),
  toolDetails: z.array(assistantToolDetailSchema).optional(),
});

/** Strongly typed final assistant message data of an SSE `result` event. */
export type AssistantMessageDataDto = z.infer<
  typeof assistantMessageDataSchema
>;

/**
 * Standard Schema (zod 4) for the body returned by
 * `POST /assistant/latest/clear`. Replaces the former
 * `AssistantClearResultDataDto` response class.
 */
export const assistantClearResultDataSchema = z.object({
  cleared: z.boolean().describe('Whether the latest conversation was cleared.'),
  archivedConversationId: z
    .string()
    .nullable()
    .describe('The archived conversation id, or null when none existed.'),
});

/** Strongly typed result of clearing the latest assistant conversation. */
export type AssistantClearResultDataDto = z.infer<
  typeof assistantClearResultDataSchema
>;

/**
 * Backwards-compatible response alias for `POST /assistant/latest/clear`;
 * identical to {@link AssistantClearResultDataDto} on the wire.
 */
export type AssistantClearResultResponseDto = AssistantClearResultDataDto;

/**
 * Standard Schema (zod 4) describing the parsed JSON `data` payloads of the
 * assistant SSE contract. Replaces the former `AssistantStreamResultDto`
 * documentation class — the HTTP body itself is `text/event-stream`, so this
 * schema is documentation/typing only and is never used for outbound
 * serialization.
 */
export const assistantStreamResultSchema = z.object({
  event: z.enum(['chunk', 'result', 'error', 'done']),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      'SSE payload object. event=chunk => { content }, event=result => AssistantMessageDataDto-like object, event=error => { type, title, detail, code, retryable?, retryAfter?, status }, event=done => {}.',
    ),
});

/** Strongly typed parsed SSE frame of the assistant stream contract. */
export type AssistantStreamResultDto = z.infer<
  typeof assistantStreamResultSchema
>;

import { z } from 'zod';

const ASSISTANT_CLIENT_MESSAGE_ROLES = ['user', 'assistant'] as const;

/**
 * Standard Schema (zod 4) for one client-supplied message inside
 * `POST /assistant/messages/stream`.
 *
 * Replaces the former class-validator DTO:
 * - `@IsIn(ASSISTANT_CLIENT_MESSAGE_ROLES)` → `z.enum(...)`;
 * - `@IsString` + `@MinLength(1)` + `@MaxLength(8_000)` →
 *   `z.string().min(1).max(8_000)`;
 * - nested `forbidNonWhitelisted` parity via `.strict()`.
 */
export const assistantInputMessageSchema = z
  .object({
    role: z
      .enum(ASSISTANT_CLIENT_MESSAGE_ROLES)
      .describe('Client-visible conversation role. system is not accepted.'),
    content: z
      .string()
      .min(1)
      .max(8_000)
      .describe('Plain or Markdown-ready message content.'),
  })
  .strict();

/** One strongly typed client-supplied conversation message. */
export type AssistantInputMessageDto = z.infer<
  typeof assistantInputMessageSchema
>;

/**
 * Standard Schema (zod 4) for `POST /assistant/messages/stream` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@ValidateNested({ each: true })` + `@Type(() => AssistantInputMessageDto)`
 *   → `z.array(assistantInputMessageSchema)`;
 * - `@ArrayMinSize(1)` / `@ArrayMaxSize(20)` → `.min(1)` / `.max(20)`;
 * - `@IsOptional` + `@IsString` + `@MaxLength(64)` →
 *   `z.string().max(64).optional()`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const streamAssistantMessagesSchema = z
  .object({
    messages: z
      .array(assistantInputMessageSchema)
      .min(1)
      .max(20)
      .describe(
        'Conversation window ending with the latest user message to answer.',
      ),
    conversationId: z
      .string()
      .max(64)
      .describe(
        'Optional persisted conversation id used as the LangGraph thread id. When absent the conversation runs statelessly (no checkpoint / no in-graph review).',
      )
      .optional(),
  })
  .strict();

/** Strongly typed request body of `POST /assistant/messages/stream`. */
export type StreamAssistantMessagesDto = z.infer<
  typeof streamAssistantMessagesSchema
>;

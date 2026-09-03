import { z } from 'zod';

/**
 * Standard Schema (zod 4) for a persisted conversation message visible to the
 * client. Replaces the former `AssistantConversationMessageDto` response
 * class.
 */
export const assistantConversationMessageSchema = z.object({
  role: z
    .enum(['user', 'assistant'])
    .describe('Persisted conversation role visible to the client.'),
  content: z.string().describe('Persisted Markdown-ready message content.'),
  usedTools: z
    .array(z.string())
    .describe(
      'Tool names recorded for this message. Non-empty for assistant messages that used tools.',
    ),
  createdAt: z
    .string()
    .describe('ISO-8601 timestamp when the message was created.'),
});

/** Strongly typed persisted conversation message. */
export type AssistantConversationMessageDto = z.infer<
  typeof assistantConversationMessageSchema
>;

/**
 * Standard Schema (zod 4) for the full persisted conversation resource
 * returned by `GET /assistant/latest`, `POST /assistant/conversations/:id/open`,
 * the rename and the delete endpoints. Replaces the former
 * `AssistantConversationDataDto` response class.
 */
export const assistantConversationDataSchema = z.object({
  id: z.string().describe('Stable persisted conversation identifier.'),
  title: z
    .string()
    .nullable()
    .describe('Optional server-derived conversation title.'),
  status: z
    .enum(['active', 'archived', 'deleted'])
    .describe('Current conversation status.'),
  messages: z
    .array(assistantConversationMessageSchema)
    .describe('Persisted messages in chronological order.'),
  lastMessageAt: z
    .string()
    .nullable()
    .describe('ISO-8601 timestamp of the latest conversation activity.'),
  createdAt: z.string().describe('ISO-8601 creation timestamp.'),
  updatedAt: z.string().describe('ISO-8601 update timestamp.'),
});

/** Strongly typed persisted assistant conversation resource. */
export type AssistantConversationDataDto = z.infer<
  typeof assistantConversationDataSchema
>;

/**
 * Backwards-compatible response alias for the conversation endpoints;
 * identical to {@link AssistantConversationDataDto} on the wire.
 */
export type AssistantConversationResponseDto = AssistantConversationDataDto;

import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one entry of
 * `GET /assistant/conversations`. Replaces the former
 * `AssistantConversationSummaryDto` response class.
 */
export const assistantConversationSummarySchema = z.object({
  id: z.string().describe('Stable persisted conversation identifier.'),
  title: z
    .string()
    .nullable()
    .describe('Optional server-derived conversation title.'),
  status: z
    .enum(['active', 'archived', 'deleted'])
    .describe('Current conversation status.'),
  lastMessageAt: z
    .string()
    .nullable()
    .describe('ISO-8601 timestamp of the latest conversation activity.'),
  createdAt: z.string().describe('ISO-8601 creation timestamp.'),
  updatedAt: z.string().describe('ISO-8601 update timestamp.'),
});

/** Strongly typed recent conversation summary item. */
export type AssistantConversationSummaryDto = z.infer<
  typeof assistantConversationSummarySchema
>;

/**
 * Array schema of the `GET /assistant/conversations` success body. Outbound
 * validation uses the item schema (the global serializer validates array
 * items one by one); this array schema backs the OpenAPI registration.
 */
export const assistantConversationListResponseSchema = z
  .array(assistantConversationSummarySchema)
  .describe('Recent assistant conversation summaries.');

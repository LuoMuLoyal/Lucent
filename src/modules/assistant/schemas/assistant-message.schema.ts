import { z } from 'zod';

export const assistantMessageRoleSchema = z.enum([
  'system',
  'user',
  'assistant',
]);

export const assistantMessageSchema = z.object({
  role: assistantMessageRoleSchema,
  content: z.string().trim().min(1).max(8_000),
});

export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

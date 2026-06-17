import { z } from 'zod';

export const aiChatMessageRoleSchema = z.enum(['system', 'user', 'assistant']);

export const aiChatMessageSchema = z.object({
  role: aiChatMessageRoleSchema,
  content: z.string().trim().min(1).max(8_000),
});

export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the preview field entries shown on a proposed
 * action card. Replaces the former module-private `AssistantPreviewFieldDto`
 * response class.
 */
const assistantPreviewFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
});

/**
 * Standard Schema (zod 4) for the write target of a proposed action.
 * Replaces the former module-private `AssistantProposalTargetDto` class.
 */
const assistantProposalTargetSchema = z.object({
  kind: z.enum(['daily_record', 'user_settings', 'daily_record_draft']),
  label: z.string(),
  recordId: z.string().optional(),
  settingKeys: z.array(z.string()).optional(),
  matchedBy: z.array(z.string()).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Standard Schema (zod 4) for a client-facing proposed write action included
 * in an assistant SSE result. Replaces the former
 * `AssistantProposedActionDto` response class.
 */
export const assistantProposedActionSchema = z.object({
  id: z
    .string()
    .describe(
      'Ephemeral proposal identifier for this streamed assistant result.',
    ),
  type: z.enum([
    'create_daily_record',
    'update_daily_record',
    'delete_daily_record',
    'update_user_settings',
  ]),
  status: z.literal('proposed'),
  confirmationRequired: z.literal(true),
  title: z.string(),
  summary: z.string(),
  reason: z.string().nullable(),
  previewFields: z.array(assistantPreviewFieldSchema),
  target: assistantProposalTargetSchema,
  constraints: z.array(z.string()),
  expiresAt: z
    .string()
    .describe('ISO-8601 expiry timestamp for this proposal snapshot.'),
  payloadVersion: z.literal(1),
  payload: z
    .unknown()
    .describe(
      'Structured proposal payload. Shape depends on action type and must be confirmed by the client before any real write happens.',
    ),
});

/** Strongly typed proposed write action for an assistant SSE result. */
export type AssistantProposedActionDto = z.infer<
  typeof assistantProposedActionSchema
>;

import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard Schema (zod 4) for
 * `POST /assistant/conversations/:conversationId/confirm` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsArray` + `@ArrayNotEmpty` + `@IsString({ each: true })` →
 *   `z.array(z.string()).min(1)`;
 * - `@IsIn(['approved', 'rejected'])` → `z.enum(...)`;
 * - `@IsOptional` + `@IsString` + `@MaxLength(500)` →
 *   `z.string().max(500).optional()`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected).
 */
export const confirmAssistantProposalSchema = z
  .object({
    proposalIds: z
      .array(z.string())
      .min(1)
      .describe('Proposal ids awaiting confirmation.'),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(500).optional(),
  })
  .strict();

/** Strongly typed request body of `POST /assistant/conversations/:conversationId/confirm`. */
export type ConfirmAssistantProposalDto = z.infer<
  typeof confirmAssistantProposalSchema
>;

export class AssistantConfirmResult {
  @ApiProperty({
    description: 'Conversation (LangGraph thread) id the proposals belong to.',
  })
  conversationId!: string;

  @ApiProperty({ enum: ['approved', 'rejected'] })
  decision!: 'approved' | 'rejected';

  @ApiProperty({ enum: ['approved', 'rejected'] })
  status!: 'approved' | 'rejected';

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Final assistant content after the decision is applied.',
  })
  finalContent!: string | null;
}

export class AssistantConfirmResultResponse extends AssistantConfirmResult {}

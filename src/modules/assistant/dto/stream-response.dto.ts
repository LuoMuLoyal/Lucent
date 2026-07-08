import { ApiProperty } from '@nestjs/swagger';
import { AssistantProposedActionDto } from './proposed-action.dto';

export class AssistantStreamChunkDto {
  @ApiProperty({
    description: 'Incremental assistant text chunk for SSE rendering.',
  })
  content!: string;
}

export class AssistantMessageDataDto {
  @ApiProperty({
    description: 'Persisted conversation identifier for this assistant reply.',
  })
  conversationId!: string;

  @ApiProperty({
    example: 'assistant',
    description: 'Final assistant role for the generated reply.',
  })
  role!: 'assistant';

  @ApiProperty({
    description: 'Full final Markdown-friendly assistant reply.',
  })
  content!: string;

  @ApiProperty({
    description:
      'Tool names actually used during generation. Allowed values follow the assistant tool contract.',
    type: [String],
    example: [],
  })
  usedTools!: string[];

  @ApiProperty({
    description: 'ISO-8601 timestamp for the final assistant reply.',
  })
  generatedAt!: string;

  @ApiProperty({
    type: () => AssistantProposedActionDto,
    isArray: true,
    required: false,
    description:
      'Optional proposal-only write intents that still require explicit client confirmation.',
  })
  proposedActions?: AssistantProposedActionDto[];
}

export class AssistantClearResultDataDto {
  @ApiProperty({
    description: 'Whether the latest conversation was cleared.',
    example: true,
  })
  cleared!: boolean;

  @ApiProperty({
    description: 'The archived conversation id, or null when none existed.',
    example: 'conversation-id',
    nullable: true,
    type: String,
  })
  archivedConversationId!: string | null;
}

export class AssistantClearResultResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => AssistantClearResultDataDto })
  data!: AssistantClearResultDataDto;
}

export class AssistantStreamResultDto {
  @ApiProperty({ enum: ['chunk', 'result', 'error', 'done'] })
  event!: 'chunk' | 'result' | 'error' | 'done';

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'SSE payload object. event=chunk => { content }, event=result => AssistantMessageDataDto-like object, event=error => { message, code?, statusCode? }, event=done => {}.',
  })
  data!: Record<string, unknown>;
}

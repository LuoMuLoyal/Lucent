import { ApiProperty } from '@nestjs/swagger';
import { AssistantProposedActionDto } from './proposed-action.dto';

export class AssistantToolDetailDto {
  @ApiProperty({ description: 'Tool name used during generation.' })
  name!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description: 'Optional display subject, e.g. the resolved product name.',
  })
  label?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: Object,
    description: 'Optional result envelope coverage.',
  })
  coverage?: {
    status: 'complete' | 'partial' | 'empty';
    reason: string | null;
  } | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: Object,
    description: 'Optional result envelope confidence.',
  })
  confidence?: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  } | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Optional result envelope ambiguities.',
  })
  ambiguities?: string[];

  @ApiProperty({
    required: false,
    nullable: true,
    type: Object,
    description: 'Optional result envelope source meta.',
  })
  source?: {
    tool: string;
    generatedAt: string;
    tables: string[];
  } | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description: 'Optional medical knowledge disclaimer from the tool result.',
  })
  disclaimer?: string | null;
}

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

  @ApiProperty({ required: false, type: AssistantToolDetailDto, isArray: true })
  toolDetails?: AssistantToolDetailDto[];
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

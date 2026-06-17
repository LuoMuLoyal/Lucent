import { ApiProperty } from '@nestjs/swagger';

export class AiChatStreamChunkDto {
  @ApiProperty({
    description: 'Incremental assistant text chunk for SSE rendering.',
  })
  content!: string;
}

export class AiChatMessageDataDto {
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
      'Tool names actually used during generation. Allowed values follow the AI chat tool contract.',
    type: [String],
    example: [],
  })
  usedTools!: string[];

  @ApiProperty({
    description: 'ISO-8601 timestamp for the final assistant reply.',
  })
  generatedAt!: string;
}

export class AiChatStreamResultDto {
  @ApiProperty({ enum: ['chunk', 'result', 'error', 'done'] })
  event!: 'chunk' | 'result' | 'error' | 'done';

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'SSE payload object. event=chunk => { content }, event=result => AiChatMessageDataDto-like object, event=error => { message, code?, statusCode? }, event=done => {}.',
  })
  data!: Record<string, unknown>;
}

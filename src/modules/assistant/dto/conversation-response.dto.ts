import { ApiProperty } from '@nestjs/swagger';

export class AssistantConversationMessageDto {
  @ApiProperty({
    enum: ['user', 'assistant'],
    description: 'Persisted conversation role visible to the client.',
  })
  role!: 'user' | 'assistant';

  @ApiProperty({
    description: 'Persisted Markdown-ready message content.',
  })
  content!: string;

  @ApiProperty({
    type: [String],
    description:
      'Tool names recorded for this message. Non-empty for assistant messages that used tools.',
    example: [],
  })
  usedTools!: string[];

  @ApiProperty({
    description: 'ISO-8601 timestamp when the message was created.',
  })
  createdAt!: string;
}

export class AssistantConversationDataDto {
  @ApiProperty({
    description: 'Stable persisted conversation identifier.',
  })
  id!: string;

  @ApiProperty({
    description: 'Optional server-derived conversation title.',
    nullable: true,
    type: String,
  })
  title!: string | null;

  @ApiProperty({
    enum: ['active', 'archived'],
    description: 'Current conversation status.',
  })
  status!: 'active' | 'archived';

  @ApiProperty({
    type: [AssistantConversationMessageDto],
    description: 'Persisted messages in chronological order.',
  })
  messages!: AssistantConversationMessageDto[];

  @ApiProperty({
    description: 'ISO-8601 timestamp of the latest conversation activity.',
    nullable: true,
    type: String,
  })
  lastMessageAt!: string | null;

  @ApiProperty({
    description: 'ISO-8601 creation timestamp.',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'ISO-8601 update timestamp.',
  })
  updatedAt!: string;
}

export class AssistantConversationResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({
    type: () => AssistantConversationDataDto,
    nullable: true,
    description: 'Persisted conversation payload, or null when none exists.',
  })
  data!: AssistantConversationDataDto | null;
}

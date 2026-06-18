import { ApiProperty } from '@nestjs/swagger';

export class AiChatConversationSummaryDto {
  @ApiProperty({
    description: 'Stable persisted conversation identifier.',
  })
  id!: string;

  @ApiProperty({
    description: 'Optional server-derived conversation title.',
    nullable: true,
  })
  title!: string | null;

  @ApiProperty({
    enum: ['active', 'archived'],
    description: 'Current conversation status.',
  })
  status!: 'active' | 'archived';

  @ApiProperty({
    description: 'ISO-8601 timestamp of the latest conversation activity.',
    nullable: true,
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

export class AiChatConversationListResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({
    type: () => AiChatConversationSummaryDto,
    isArray: true,
    description:
      'Recent persisted conversations for the authenticated user, newest first.',
  })
  data!: AiChatConversationSummaryDto[];
}

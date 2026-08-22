import { ApiProperty } from '@nestjs/swagger';

export class AssistantConversationSummaryDto {
  @ApiProperty({ description: 'Stable persisted conversation identifier.' })
  id!: string;

  @ApiProperty({
    description: 'Optional server-derived conversation title.',
    nullable: true,
    type: String,
  })
  title!: string | null;

  @ApiProperty({
    enum: ['active', 'archived', 'deleted'],
    description: 'Current conversation status.',
  })
  status!: 'active' | 'archived' | 'deleted';

  @ApiProperty({
    description: 'ISO-8601 timestamp of the latest conversation activity.',
    nullable: true,
    type: String,
  })
  lastMessageAt!: string | null;

  @ApiProperty({ description: 'ISO-8601 creation timestamp.' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO-8601 update timestamp.' })
  updatedAt!: string;
}

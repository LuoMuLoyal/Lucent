import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const AI_CHAT_CLIENT_MESSAGE_ROLES = ['user', 'assistant'] as const;

export class AiChatInputMessageDto {
  @ApiProperty({
    enum: AI_CHAT_CLIENT_MESSAGE_ROLES,
    description: 'Client-visible conversation role. system is not accepted.',
  })
  @IsIn(AI_CHAT_CLIENT_MESSAGE_ROLES)
  role!: 'user' | 'assistant';

  @ApiProperty({
    description: 'Plain or Markdown-ready message content.',
    maxLength: 8_000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  content!: string;
}

export class StreamAiChatMessagesDto {
  @ApiProperty({
    type: () => AiChatInputMessageDto,
    isArray: true,
    description:
      'Conversation window ending with the latest user message to answer.',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiChatInputMessageDto)
  messages!: AiChatInputMessageDto[];
}

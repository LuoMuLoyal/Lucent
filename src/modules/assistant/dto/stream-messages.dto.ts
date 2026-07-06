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

const ASSISTANT_CLIENT_MESSAGE_ROLES = ['user', 'assistant'] as const;

export class AssistantInputMessageDto {
  @ApiProperty({
    enum: ASSISTANT_CLIENT_MESSAGE_ROLES,
    description: 'Client-visible conversation role. system is not accepted.',
  })
  @IsIn(ASSISTANT_CLIENT_MESSAGE_ROLES)
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

export class StreamAssistantMessagesDto {
  @ApiProperty({
    type: () => AssistantInputMessageDto,
    isArray: true,
    description:
      'Conversation window ending with the latest user message to answer.',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantInputMessageDto)
  messages!: AssistantInputMessageDto[];
}

import { ApiProperty } from '@nestjs/swagger';

export class AssistantClearMemoryDataDto {
  @ApiProperty({
    description: 'Number of persisted assistant memory rows deleted.',
    example: 3,
  })
  cleared!: number;
}

export class AssistantClearMemoryResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => AssistantClearMemoryDataDto })
  data!: AssistantClearMemoryDataDto;
}

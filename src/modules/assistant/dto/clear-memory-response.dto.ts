import { ApiProperty } from '@nestjs/swagger';

export class AssistantClearMemoryDataDto {
  @ApiProperty({
    description: 'Number of persisted assistant memory rows deleted.',
    example: 3,
  })
  cleared!: number;
}

export class AssistantClearMemoryResponseDto extends AssistantClearMemoryDataDto {}

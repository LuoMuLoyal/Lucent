import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RunRiskCheckDto {
  @ApiProperty({
    enum: ['static', 'llm'],
    description: 'Type of risk check to run',
  })
  @IsEnum(['static', 'llm'])
  type!: 'static' | 'llm';
}

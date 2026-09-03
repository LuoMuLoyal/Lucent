import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { HealthEventOutcome } from '#generated/prisma/client.js';

export class EndHealthEventDto {
  @ApiProperty({
    description: 'User-confirmed outcome when ending the event.',
    enum: HealthEventOutcome,
    enumName: 'HealthEventOutcome',
  })
  @IsEnum(HealthEventOutcome)
  outcome!: HealthEventOutcome;
}

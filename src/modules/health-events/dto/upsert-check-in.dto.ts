import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { HealthEventOutcome } from '#generated/prisma/client';

export class UpsertHealthEventCheckInDto {
  @ApiProperty({
    description: 'User-confirmed outcome for the requested calendar date.',
    enum: HealthEventOutcome,
    enumName: 'HealthEventOutcome',
  })
  @IsEnum(HealthEventOutcome)
  outcome!: HealthEventOutcome;
}

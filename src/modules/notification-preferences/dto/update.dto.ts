import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Enable health-rule notifications.' })
  @IsOptional()
  @IsBoolean()
  healthAlertsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable weekly longitudinal insights.' })
  @IsOptional()
  @IsBoolean()
  weeklyInsightEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable water shortfall notifications.' })
  @IsOptional()
  @IsBoolean()
  waterRemindersEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable local bedtime sleep reminders.' })
  @IsOptional()
  @IsBoolean()
  sleepReminderEnabled?: boolean;

  @ApiPropertyOptional({
    type: Number,
    format: 'int32',
    nullable: true,
    minimum: 0,
    maximum: 1439,
    description: 'Bedtime as minutes after local midnight.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  sleepBedtimeMinutes?: number | null;

  @ApiPropertyOptional({
    type: Number,
    format: 'int32',
    nullable: true,
    minimum: 0,
    maximum: 1439,
    description: 'Wake time as minutes after local midnight.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  sleepWakeTimeMinutes?: number | null;
}

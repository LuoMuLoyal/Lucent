import { ApiProperty } from '@nestjs/swagger';

export class NotificationPreferencesDataDto {
  @ApiProperty()
  healthAlertsEnabled!: boolean;

  @ApiProperty()
  weeklyInsightEnabled!: boolean;

  @ApiProperty()
  waterRemindersEnabled!: boolean;

  @ApiProperty()
  sleepReminderEnabled!: boolean;

  @ApiProperty({ type: Number, format: 'int32', nullable: true })
  sleepBedtimeMinutes!: number | null;

  @ApiProperty({ type: Number, format: 'int32', nullable: true })
  sleepWakeTimeMinutes!: number | null;

  @ApiProperty({
    description: 'Whether the user has a persisted preference row.',
  })
  configured!: boolean;

  @ApiProperty({ type: String, nullable: true })
  updatedAt!: string | null;
}

export class NotificationPreferencesResponseDto extends NotificationPreferencesDataDto {}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicineReminderItemDto {
  @ApiProperty({ description: 'Reminder id.' })
  id!: string;

  @ApiPropertyOptional({
    description: 'Linked current medicine id.',
    type: String,
    nullable: true,
  })
  currentMedicineId!: string | null;

  @ApiPropertyOptional({
    description: 'Reminder label.',
    type: String,
    nullable: true,
  })
  label!: string | null;

  @ApiProperty({ description: 'Scheduled local hour, 0-23.' })
  scheduledHour!: number;

  @ApiProperty({ description: 'Scheduled local minute, 0-59.' })
  scheduledMinute!: number;

  @ApiPropertyOptional({
    description: 'Weekday numbers 0-6. Null means every day.',
    type: Number,
    isArray: true,
    nullable: true,
  })
  daysOfWeek!: number[] | null;

  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format when the reminder starts.',
    nullable: true,
    type: String,
  })
  startDate!: string | null;

  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format when the reminder ends.',
    nullable: true,
    type: String,
  })
  endDate!: string | null;

  @ApiProperty({ description: 'Whether this reminder is active.' })
  isActive!: boolean;

  @ApiPropertyOptional({
    description: 'User note.',
    type: String,
    nullable: true,
  })
  note!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}

export class MedicineReminderListDataDto {
  @ApiProperty({ type: () => MedicineReminderItemDto, isArray: true })
  items!: MedicineReminderItemDto[];
}

export class MedicineReminderListResponseDto extends MedicineReminderListDataDto {}

export class MedicineReminderResponseDto extends MedicineReminderItemDto {}

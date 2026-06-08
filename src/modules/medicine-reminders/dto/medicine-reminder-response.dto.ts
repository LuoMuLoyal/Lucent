import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MedicineReminderItemDto {
  @ApiProperty({ description: 'Reminder id.' })
  id!: string;

  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  currentMedicineId!: string | null;

  @ApiPropertyOptional({ description: 'Reminder label.' })
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

  @ApiProperty({ description: 'Whether this reminder is active.' })
  isActive!: boolean;

  @ApiPropertyOptional({ description: 'User note.' })
  note!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}

class MedicineReminderListDataDto {
  @ApiProperty({ type: () => MedicineReminderItemDto, isArray: true })
  items!: MedicineReminderItemDto[];
}

export class MedicineReminderListResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineReminderListDataDto })
  data!: MedicineReminderListDataDto;
}

export class MedicineReminderResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineReminderItemDto })
  data!: MedicineReminderItemDto;
}

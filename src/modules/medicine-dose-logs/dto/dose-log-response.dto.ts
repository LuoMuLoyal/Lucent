import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DoseLogStatus } from '#generated/prisma/client';

class DoseLogItemDto {
  @ApiProperty({ description: 'Dose log id.' })
  id!: string;

  @ApiPropertyOptional({
    description: 'Linked health event id.',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  healthEventId!: string | null;

  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  currentMedicineId!: string | null;

  @ApiPropertyOptional({
    description: 'Linked reminder id for slot-aware logs.',
  })
  reminderId!: string | null;

  @ApiProperty({ enum: DoseLogStatus, enumName: 'DoseLogStatus' })
  status!: DoseLogStatus;

  @ApiProperty({
    description: 'Scheduled date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  scheduledFor!: string;

  @ApiPropertyOptional({
    description: 'Scheduled slot time in HH:mm format.',
    example: '08:30',
  })
  scheduledTime!: string | null;

  @ApiPropertyOptional({ description: 'Dose text.' })
  doseText!: string | null;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  note!: string | null;

  @ApiPropertyOptional({ description: 'Source.', example: 'manual' })
  source!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}

class DoseLogListDataDto {
  @ApiProperty({ type: () => DoseLogItemDto, isArray: true })
  items!: DoseLogItemDto[];

  @ApiProperty({ description: 'Total count of dose logs for the date.' })
  total!: number;
}

export class DoseLogListResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DoseLogListDataDto })
  data!: DoseLogListDataDto;
}

export class DoseLogResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DoseLogItemDto })
  data!: DoseLogItemDto;
}

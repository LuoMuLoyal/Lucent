import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DoseLogStatus } from '#generated/prisma/client';

class DoseLogItemDto {
  @ApiProperty({ description: 'Dose log id.' })
  id!: string;

  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  currentMedicineId!: string | null;

  @ApiProperty({ enum: DoseLogStatus, enumName: 'DoseLogStatus' })
  status!: DoseLogStatus;

  @ApiProperty({
    description: 'Scheduled date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  scheduledFor!: string;

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

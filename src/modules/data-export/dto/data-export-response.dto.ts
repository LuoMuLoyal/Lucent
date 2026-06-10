import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const DATA_EXPORT_STATUSES = [
  'requested',
  'processing',
  'completed',
  'failed',
  'unavailable',
] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export class DataExportRequestDataDto {
  @ApiProperty({ description: 'Unique request identifier.' })
  id!: string;

  @ApiProperty({
    enum: DATA_EXPORT_STATUSES,
    enumName: 'DataExportStatus',
  })
  status!: DataExportStatus;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the request was created.',
  })
  requestedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  downloadUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage!: string | null;
}

export class DataExportRequestResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => DataExportRequestDataDto })
  data!: DataExportRequestDataDto;
}

export class DataExportLatestResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => DataExportRequestDataDto, nullable: true })
  data!: DataExportRequestDataDto | null;
}

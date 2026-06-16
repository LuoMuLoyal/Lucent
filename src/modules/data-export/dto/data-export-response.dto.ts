import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const DATA_EXPORT_STATUSES = [
  'requested',
  'processing',
  'completed',
  'failed',
  'unavailable',
] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export const DATA_EXPORT_KINDS = ['hospital', 'monthly', 'print'] as const;
export type DataExportKind = (typeof DATA_EXPORT_KINDS)[number];

export const DATA_EXPORT_FORMATS = ['pdf'] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

export const DATA_EXPORT_RANGES = ['last_7_days', 'last_30_days'] as const;
export type DataExportRange = (typeof DATA_EXPORT_RANGES)[number];

export class CreateDataExportRequestDto {
  @ApiPropertyOptional({
    enum: DATA_EXPORT_KINDS,
    default: 'hospital',
    description: 'Requested export kind.',
  })
  @IsOptional()
  @IsIn(DATA_EXPORT_KINDS)
  kind?: DataExportKind = 'hospital';

  @ApiPropertyOptional({
    enum: DATA_EXPORT_FORMATS,
    default: 'pdf',
    description: 'Requested export format.',
  })
  @IsOptional()
  @IsIn(DATA_EXPORT_FORMATS)
  format?: DataExportFormat = 'pdf';

  @ApiPropertyOptional({
    enum: DATA_EXPORT_RANGES,
    default: 'last_7_days',
    description: 'Requested report range.',
  })
  @IsOptional()
  @IsIn(DATA_EXPORT_RANGES)
  range?: DataExportRange = 'last_7_days';
}

export class DataExportRequestDataDto {
  @ApiProperty({ description: 'Unique request identifier.' })
  id!: string;

  @ApiProperty({
    enum: DATA_EXPORT_KINDS,
    enumName: 'DataExportKind',
  })
  kind!: DataExportKind;

  @ApiProperty({
    enum: DATA_EXPORT_FORMATS,
    enumName: 'DataExportFormat',
  })
  format!: DataExportFormat;

  @ApiProperty({
    enum: DATA_EXPORT_RANGES,
    enumName: 'DataExportRange',
  })
  range!: DataExportRange;

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
  fileName!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  fileSizeBytes!: number | null;

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

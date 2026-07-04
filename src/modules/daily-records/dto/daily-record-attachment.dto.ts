import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DailyRecordAttachmentKind } from '#generated/prisma/client';

export class DailyRecordAttachmentInputDto {
  @ApiPropertyOptional({
    enum: DailyRecordAttachmentKind,
    enumName: 'DailyRecordAttachmentKind',
    default: DailyRecordAttachmentKind.image,
  })
  @IsOptional()
  @IsEnum(DailyRecordAttachmentKind)
  kind?: DailyRecordAttachmentKind;

  @ApiProperty({
    description: 'Object storage key, stable across signed URL rotations.',
    example: 'daily-records/user-id/2026-06-06/photo.jpg',
  })
  @IsString()
  @MaxLength(500)
  objectKey!: string;

  @ApiPropertyOptional({ description: 'Object storage bucket.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bucket?: string | null;

  @ApiPropertyOptional({
    description: 'Storage provider, currently tencent-cos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string | null;

  @ApiPropertyOptional({ description: 'Original file name.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string | null;

  @ApiPropertyOptional({
    description: 'MIME content type.',
    example: 'image/jpeg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contentType?: string | null;

  @ApiPropertyOptional({ description: 'File size in bytes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50_000_000)
  sizeBytes?: number | null;

  @ApiPropertyOptional({ description: 'Image width in pixels.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  width?: number | null;

  @ApiPropertyOptional({ description: 'Image height in pixels.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  height?: number | null;

  @ApiPropertyOptional({
    description: 'Optional public or already-signed display URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  publicUrl?: string | null;
}

export class DailyRecordAttachmentDto {
  @ApiProperty({ description: 'Attachment id.' })
  id!: string;

  @ApiProperty({
    enum: DailyRecordAttachmentKind,
    enumName: 'DailyRecordAttachmentKind',
  })
  kind!: DailyRecordAttachmentKind;

  @ApiProperty({ description: 'Object storage key.' })
  objectKey!: string;

  @ApiPropertyOptional({ description: 'Object storage bucket.' })
  bucket!: string | null;

  @ApiPropertyOptional({ description: 'Storage provider.' })
  provider!: string | null;

  @ApiPropertyOptional({ description: 'Original file name.' })
  fileName!: string | null;

  @ApiPropertyOptional({ description: 'MIME content type.' })
  contentType!: string | null;

  @ApiPropertyOptional({ description: 'File size in bytes.' })
  sizeBytes!: number | null;

  @ApiPropertyOptional({ description: 'Image width in pixels.' })
  width!: number | null;

  @ApiPropertyOptional({ description: 'Image height in pixels.' })
  height!: number | null;

  @ApiPropertyOptional({ description: 'Public or signed display URL.' })
  publicUrl!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;
}

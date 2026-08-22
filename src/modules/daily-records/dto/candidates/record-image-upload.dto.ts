import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDailyRecordImageUploadDto {
  @ApiProperty({
    description: 'Image MIME content type.',
    example: 'image/jpeg',
  })
  @IsString()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({
    description: 'File size in bytes.',
    example: 1_234_567,
  })
  @IsInt()
  @Min(1)
  @Max(50_000_000)
  sizeBytes!: number;

  @ApiPropertyOptional({
    description: 'Original file name.',
    example: 'breakfast.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}

export class DailyRecordImageUploadDto {
  @ApiProperty({ example: 'tencent-cos' })
  provider!: string;

  @ApiProperty({ example: 'lucent-test-bucket' })
  bucket!: string;

  @ApiProperty({
    example: 'daily-records/user-id/2026/06/06/generated-id.jpg',
  })
  objectKey!: string;

  @ApiProperty({
    description: 'Signed PUT URL for direct object storage upload.',
  })
  uploadUrl!: string;

  @ApiProperty({
    description: 'Headers that must be sent with the PUT upload.',
  })
  headers!: Record<string, string>;

  @ApiProperty({
    description:
      'Optional public/CDN URL when a public base URL is configured.',
  })
  publicUrl!: string | null;

  @ApiProperty({ description: 'Signed URL expiry timestamp (ISO 8601).' })
  expiresAt!: string;

  @ApiProperty({ description: 'Maximum accepted upload size in bytes.' })
  maxSizeBytes!: number;
}

export class DailyRecordImageUploadResponseDto extends DailyRecordImageUploadDto {}

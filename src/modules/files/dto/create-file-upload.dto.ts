import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateFileUploadDto {
  @ApiProperty({ description: 'MIME type', example: 'image/jpeg' })
  @IsString()
  @MinLength(1)
  @Matches(/^[a-z]+\/[-a-z0-9+.]+$/i)
  contentType!: string;

  @ApiProperty({ description: 'File size in bytes', example: 204800 })
  @IsPositive()
  @IsInt()
  sizeBytes!: number;

  @ApiPropertyOptional({
    description: 'Original filename',
    example: 'photo.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\\/]+$/)
  fileName?: string;
}

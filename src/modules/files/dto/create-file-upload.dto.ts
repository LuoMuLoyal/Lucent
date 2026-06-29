import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFileUploadDto {
  @ApiProperty({ description: 'MIME type', example: 'image/jpeg' })
  contentType!: string;

  @ApiProperty({ description: 'File size in bytes', example: 204800 })
  sizeBytes!: number;

  @ApiPropertyOptional({
    description: 'Original filename',
    example: 'photo.jpg',
  })
  fileName?: string;
}

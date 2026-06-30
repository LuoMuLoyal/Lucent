import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class RecognizeMedicineDto {
  @ApiProperty({
    description: 'Public URL of the medicine box image',
    example: 'https://cos.example.com/files/abc.jpg',
  })
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  imageUrl!: string;
}

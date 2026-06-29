import { ApiProperty } from '@nestjs/swagger';

export class RecognizeMedicineDto {
  @ApiProperty({
    description: 'Public URL of the medicine box image',
    example: 'https://cos.example.com/files/abc.jpg',
  })
  imageUrl!: string;
}

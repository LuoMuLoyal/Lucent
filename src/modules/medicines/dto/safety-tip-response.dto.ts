import { ApiProperty } from '@nestjs/swagger';

export class MedicineSafetyTipResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: '服药期间如需饮酒，建议间隔至少 24 小时以上。' })
  text!: string;

  @ApiProperty({ example: 'alcohol' })
  category!: string;
}

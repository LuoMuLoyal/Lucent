import { ApiProperty } from '@nestjs/swagger';

import { MedicineDetailDataDto } from './detail.dto';
import { MedicineSearchDataDto } from './search.dto';

export class MedicineSearchResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineSearchDataDto })
  data!: MedicineSearchDataDto;
}

export class MedicineDetailResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineDetailDataDto })
  data!: MedicineDetailDataDto;
}

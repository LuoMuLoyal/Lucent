import { ApiProperty } from '@nestjs/swagger';

import { MedicineDetailDataDto } from './medicine-detail.dto';
import {
  MedicineSearchItemDto,
  MedicineSearchMetaDto,
} from './medicine-search.dto';

export class MedicineSearchResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineSearchItemDto, isArray: true })
  data!: MedicineSearchItemDto[];

  @ApiProperty({ type: () => MedicineSearchMetaDto })
  meta!: MedicineSearchMetaDto;
}

export class MedicineDetailResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineDetailDataDto })
  data!: MedicineDetailDataDto;
}

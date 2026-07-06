import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateDailyRecordCandidatesDto {
  @ApiProperty({
    description:
      'Natural-language note to be parsed into candidate daily records.',
    example: '今天头疼，早上喝了两杯水，中午吃了面，昨晚只睡了6小时。',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({
    description:
      'Wake date in YYYY-MM-DD format used as the candidate record date baseline.',
    example: '2026-06-14',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiProperty({
    description:
      'Optional user timezone hint used only for interpretation wording. No server timezone conversion is persisted.',
    example: 'Asia/Shanghai',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

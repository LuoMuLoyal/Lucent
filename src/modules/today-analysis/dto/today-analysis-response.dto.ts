import { ApiProperty } from '@nestjs/swagger';

export class TodayAnalysisBulletDto {
  @ApiProperty({
    enum: ['medication', 'hydration', 'sleep', 'general'],
  })
  kind!: 'medication' | 'hydration' | 'sleep' | 'general';

  @ApiProperty()
  text!: string;
}

export class TodayAnalysisDataDto {
  @ApiProperty()
  date!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: () => TodayAnalysisBulletDto, isArray: true })
  bullets!: TodayAnalysisBulletDto[];

  @ApiProperty()
  actionLabel!: string;

  @ApiProperty()
  confidenceNote!: string;
}

export class TodayAnalysisResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => TodayAnalysisDataDto })
  data!: TodayAnalysisDataDto;
}

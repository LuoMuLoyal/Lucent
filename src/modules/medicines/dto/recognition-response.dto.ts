import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicineRecognitionResultDto {
  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ nullable: true })
  approvalNumber!: string | null;

  @ApiProperty({ nullable: true })
  specification!: string | null;

  @ApiProperty({ nullable: true })
  manufacturer!: string | null;
}

/** Exactly one of `jobId` and `result` is present in the response. */
export class MedicineRecognitionAsyncResponseDto {
  @ApiPropertyOptional({ description: 'Queued recognition job identifier.' })
  jobId?: string;

  @ApiPropertyOptional({
    type: () => MedicineRecognitionResultDto,
    description:
      'Inline recognition resource when queue processing is unavailable.',
  })
  result?: MedicineRecognitionResultDto;
}

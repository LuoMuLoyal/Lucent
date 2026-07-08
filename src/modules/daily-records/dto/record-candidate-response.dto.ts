import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DAILY_RECORD_CANDIDATE_KINDS } from '../schemas/daily-record-candidates.schema';

export type DailyRecordCandidateKind =
  (typeof DAILY_RECORD_CANDIDATE_KINDS)[number];

class DailyRecordCandidateItemDto {
  @ApiProperty({
    enum: DAILY_RECORD_CANDIDATE_KINDS,
    enumName: 'DailyRecordCandidateKind',
  })
  kind!: DailyRecordCandidateKind;

  @ApiProperty({
    description: 'Candidate occurred date in YYYY-MM-DD format.',
    example: '2026-06-14',
  })
  occurredAt!: string;

  @ApiPropertyOptional({
    description: 'Short candidate title.',
    nullable: true,
    type: String,
  })
  title!: string | null;

  @ApiPropertyOptional({
    description: 'Candidate measured value.',
    nullable: true,
    type: String,
  })
  value!: string | null;

  @ApiPropertyOptional({
    description: 'Candidate unit.',
    nullable: true,
    type: String,
  })
  unit!: string | null;

  @ApiPropertyOptional({
    description: 'Candidate free-text note.',
    nullable: true,
    type: String,
  })
  note!: string | null;

  @ApiPropertyOptional({
    description:
      'Structured candidate payload. For sleep, this may include durationMinutes and optional timing hints.',
    type: Object,
    additionalProperties: true,
    nullable: true,
  })
  payload!: Record<string, unknown> | null;

  @ApiProperty({
    description:
      'Human-readable reason showing which phrase or fact led to this candidate.',
    example: 'Detected headache symptom from “今天头疼”.',
  })
  rationale!: string;
}

class DailyRecordCandidateDataDto {
  @ApiProperty({
    description: 'Normalized parse locale.',
    example: 'zh-CN',
  })
  locale!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp when candidates were generated.',
    example: '2026-06-14T10:20:30.000Z',
  })
  generatedAt!: string;

  @ApiProperty({
    description:
      'Short UI hint telling the client that these are candidates, not saved records.',
    example:
      'Review these candidates before saving them to your daily records.',
  })
  confirmationHint!: string;

  @ApiProperty({ type: () => DailyRecordCandidateItemDto, isArray: true })
  items!: DailyRecordCandidateItemDto[];
}

export class DailyRecordCandidateResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordCandidateDataDto })
  data!: DailyRecordCandidateDataDto;
}

export type DailyRecordCandidateData = DailyRecordCandidateDataDto;

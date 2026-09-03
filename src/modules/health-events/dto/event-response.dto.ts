import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';

export class HealthEventCheckInResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty({ description: 'Calendar date in YYYY-MM-DD format.' })
  date!: string;

  @ApiProperty({ enum: HealthEventOutcome, enumName: 'HealthEventOutcome' })
  outcome!: HealthEventOutcome;

  @ApiProperty({ description: 'Creation time in ISO 8601 format.' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update time in ISO 8601 format.' })
  updatedAt!: string;
}

export class HealthEventCoverageDto {
  @ApiProperty({ description: 'Number of user-confirmed daily check-ins.' })
  checkInCount!: number;

  @ApiPropertyOptional({
    type: String,
    description: 'First check-in calendar date, or null when none exists.',
    nullable: true,
  })
  firstCheckInDate!: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Last check-in calendar date, or null when none exists.',
    nullable: true,
  })
  lastCheckInDate!: string | null;
}

export class HealthEventItemDto {
  @ApiProperty({ enum: HealthEventKind, enumName: 'HealthEventKind' })
  kind!: HealthEventKind;

  @ApiProperty()
  id!: string;

  @ApiProperty({ maxLength: 80 })
  title!: string;

  @ApiProperty({ enum: HealthEventStatus, enumName: 'HealthEventStatus' })
  status!: HealthEventStatus;

  @ApiProperty({ description: 'Start time in ISO 8601 format.' })
  startedAt!: string;

  @ApiProperty({
    type: String,
    description: 'End time in ISO 8601 format, or null while active.',
    nullable: true,
  })
  endedAt!: string | null;

  @ApiProperty({
    enum: HealthEventOutcome,
    enumName: 'HealthEventOutcome',
    nullable: true,
  })
  outcome!: HealthEventOutcome | null;

  @ApiProperty({ type: String, nullable: true })
  reasonRecordId!: string | null;

  @ApiProperty({ type: String, isArray: true })
  currentMedicineIds!: string[];

  @ApiProperty({
    type: () => HealthEventCheckInResponseDto,
    nullable: true,
  })
  checkIn!: HealthEventCheckInResponseDto | null;

  @ApiProperty({ type: () => HealthEventCoverageDto })
  coverage!: HealthEventCoverageDto;
}

export class HealthEventListDataDto {
  @ApiProperty({ type: () => HealthEventItemDto, isArray: true })
  items!: HealthEventItemDto[];

  @ApiProperty()
  total!: number;
}

export class HealthEventResponseDto extends HealthEventItemDto {}

export class HealthEventNullableResponseDto extends HealthEventItemDto {}

export class HealthEventListResponseDto extends HealthEventListDataDto {}

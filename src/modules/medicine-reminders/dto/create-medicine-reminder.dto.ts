import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMedicineReminderDto {
  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentMedicineId?: string;

  @ApiPropertyOptional({
    description: 'Reminder label.',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label?: string | null;

  @ApiProperty({ description: 'Scheduled local hour, 0-23.', example: 8 })
  @IsInt()
  @Min(0)
  @Max(23)
  scheduledHour!: number;

  @ApiProperty({ description: 'Scheduled local minute, 0-59.', example: 30 })
  @IsInt()
  @Min(0)
  @Max(59)
  scheduledMinute!: number;

  @ApiPropertyOptional({
    description: 'Weekday numbers 0-6, where null means every day.',
    type: Number,
    isArray: true,
    nullable: true,
    example: [1, 2, 3, 4, 5],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[] | null;

  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format when the reminder starts.',
    nullable: true,
    type: String,
    example: '2026-06-09',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format when the reminder ends.',
    nullable: true,
    type: String,
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({
    description: 'Whether this reminder is active.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'User note.',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

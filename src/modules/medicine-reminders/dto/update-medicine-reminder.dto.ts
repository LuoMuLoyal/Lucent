import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateMedicineReminderDto {
  @ApiPropertyOptional({
    description: 'Linked current medicine id.',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentMedicineId?: string | null;

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

  @ApiPropertyOptional({ description: 'Scheduled local hour, 0-23.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  scheduledHour?: number;

  @ApiPropertyOptional({ description: 'Scheduled local minute, 0-59.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  scheduledMinute?: number;

  @ApiPropertyOptional({
    description: 'Weekday numbers 0-6, where null means every day.',
    type: Number,
    isArray: true,
    nullable: true,
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
    description:
      'Date in YYYY-MM-DD format when the reminder starts. Use null to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({
    description:
      'Date in YYYY-MM-DD format when the reminder ends. Use null to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ description: 'Whether this reminder is active.' })
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
  @IsNotEmpty()
  @MaxLength(500)
  note?: string | null;
}

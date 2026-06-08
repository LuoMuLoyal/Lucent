import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMedicineReminderDto {
  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  @IsOptional()
  @IsString()
  currentMedicineId?: string | null;

  @ApiPropertyOptional({ description: 'Reminder label.' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ description: 'Whether this reminder is active.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'User note.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

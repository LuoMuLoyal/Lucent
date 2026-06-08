import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateMedicineReminderDto {
  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  @IsOptional()
  @IsString()
  currentMedicineId?: string;

  @ApiPropertyOptional({ description: 'Reminder label.' })
  @IsOptional()
  @IsString()
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
    description: 'Whether this reminder is active.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'User note.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

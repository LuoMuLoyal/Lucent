import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateHealthEventDto {
  @ApiProperty({
    description: 'Short user-defined event title.',
    maxLength: 80,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'title must contain a non-whitespace character' })
  @MaxLength(80)
  title!: string;

  @ApiPropertyOptional({
    description: 'Optional daily-record id that prompted this event.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reasonRecordId?: string | null;

  @ApiPropertyOptional({
    description: 'Optional current-medicine ids to associate with this event.',
    type: String,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  currentMedicineIds?: string[];
}

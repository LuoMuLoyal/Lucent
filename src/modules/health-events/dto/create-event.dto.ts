import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { HealthEventKind } from '#generated/prisma/client';

export class CreateHealthEventDto {
  @ApiPropertyOptional({
    enum: HealthEventKind,
    enumName: 'HealthEventKind',
    description: 'Persisted semantic kind used for check-in routing.',
    default: HealthEventKind.symptom,
  })
  @IsOptional()
  @IsEnum(HealthEventKind)
  kind?: HealthEventKind;

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

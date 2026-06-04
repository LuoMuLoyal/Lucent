import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserConditionStatus } from '../../generated/prisma/client';

export class CreateHealthContextConditionDto {
  @ApiProperty({
    description: 'Condition label.',
    example: 'Asthma',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({
    description: 'Condition status. Defaults to active.',
    enum: UserConditionStatus,
    enumName: 'UserConditionStatus',
    example: UserConditionStatus.active,
  })
  @IsOptional()
  @IsEnum(UserConditionStatus)
  status?: UserConditionStatus;

  @ApiPropertyOptional({
    description: 'Diagnosis date in YYYY-MM-DD format.',
    example: '2024-02-01',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'diagnosedAt must be in YYYY-MM-DD format',
  })
  diagnosedAt?: string | null;

  @ApiPropertyOptional({
    description: 'User note for the condition.',
    example: 'Triggered during pollen season',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

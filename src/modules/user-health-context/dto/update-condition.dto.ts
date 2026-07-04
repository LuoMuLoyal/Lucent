import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserConditionStatus } from '#generated/prisma/client';

export class UpdateHealthContextConditionDto {
  @ApiPropertyOptional({
    description: 'Condition label.',
    example: 'Asthma',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    description: 'Condition status.',
    enum: UserConditionStatus,
    enumName: 'UserConditionStatus',
  })
  @IsOptional()
  @IsEnum(UserConditionStatus)
  status?: UserConditionStatus;

  @ApiPropertyOptional({
    description: 'Diagnosis date in YYYY-MM-DD format. Use null to clear.',
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
    description: 'User note for the condition. Use null to clear.',
    example: 'Triggered during pollen season',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserAllergyKind, UserAllergySeverity } from '#generated/prisma/client';

export class UpdateHealthContextAllergyDto {
  @ApiPropertyOptional({
    description: 'Allergy kind.',
    enum: UserAllergyKind,
    enumName: 'UserAllergyKind',
  })
  @IsOptional()
  @IsEnum(UserAllergyKind)
  kind?: UserAllergyKind;

  @ApiPropertyOptional({
    description: 'User-visible allergy label.',
    example: 'Penicillin',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    description: 'Recorded reaction. Use null to clear.',
    example: 'Rash',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reaction?: string | null;

  @ApiPropertyOptional({
    description: 'Severity level.',
    enum: UserAllergySeverity,
    enumName: 'UserAllergySeverity',
  })
  @IsOptional()
  @IsEnum(UserAllergySeverity)
  severity?: UserAllergySeverity;

  @ApiPropertyOptional({
    description: 'User note for the allergy. Use null to clear.',
    example: 'Avoid completely',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    description: 'When this allergy was recorded in ISO 8601 format.',
    example: '2026-06-03T09:00:00.000Z',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the allergy is currently active.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

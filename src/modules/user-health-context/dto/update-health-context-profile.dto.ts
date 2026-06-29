import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SexAtBirth, UnitSystem } from '../../../generated/prisma/client';

export class UpdateHealthContextProfileDto {
  @ApiPropertyOptional({
    description:
      'Preferred locale. Use null or empty string to clear and follow the client default.',
    example: 'zh-CN',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string | null;

  @ApiPropertyOptional({
    description: 'Preferred timezone. Use null or empty string to clear.',
    example: 'Asia/Shanghai',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiPropertyOptional({
    description: 'Preferred unit system. Use null to clear.',
    enum: UnitSystem,
    enumName: 'UnitSystem',
    example: UnitSystem.metric,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(UnitSystem)
  unitSystem?: UnitSystem | null;

  @ApiPropertyOptional({
    description: 'Birth date in YYYY-MM-DD format.',
    example: '1998-03-15',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'birthDate must be in YYYY-MM-DD format',
  })
  birthDate?: string | null;

  @ApiPropertyOptional({
    description: 'Sex assigned at birth. Use null to clear.',
    enum: SexAtBirth,
    enumName: 'SexAtBirth',
    example: SexAtBirth.female,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(SexAtBirth)
  sexAtBirth?: SexAtBirth | null;

  @ApiPropertyOptional({
    description: 'Height in centimeters. Use null to clear.',
    example: 168,
    minimum: 1,
    maximum: 300,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  heightCm?: number | null;

  @ApiPropertyOptional({
    description: 'Blood type. Use null to clear.',
    example: 'O+',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  bloodType?: string | null;

  @ApiPropertyOptional({
    description:
      'Set true to complete onboarding (sets completedAt when missing). Set false to clear onboarding completion.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;
}

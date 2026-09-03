import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  UserAllergyKind,
  UserAllergySeverity,
} from '#generated/prisma/client.js';

export class CreateHealthContextAllergyDto {
  @ApiProperty({
    description: 'Allergy kind.',
    enum: UserAllergyKind,
    enumName: 'UserAllergyKind',
    example: UserAllergyKind.drug,
  })
  @IsEnum(UserAllergyKind)
  kind!: UserAllergyKind;

  @ApiProperty({
    description: 'User-visible allergy label.',
    example: 'Penicillin',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({
    description: 'Recorded reaction.',
    example: 'Rash',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reaction?: string;

  @ApiPropertyOptional({
    description: 'Severity level. Defaults to unknown.',
    enum: UserAllergySeverity,
    enumName: 'UserAllergySeverity',
    example: UserAllergySeverity.moderate,
  })
  @IsOptional()
  @IsEnum(UserAllergySeverity)
  severity?: UserAllergySeverity;

  @ApiPropertyOptional({
    description: 'User note for the allergy.',
    example: 'Avoid completely',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description: 'When this allergy was recorded in ISO 8601 format.',
    example: '2026-06-03T09:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}

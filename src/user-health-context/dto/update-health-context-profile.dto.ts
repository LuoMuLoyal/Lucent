import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UnitSystem } from '../../generated/prisma/client';

export class UpdateHealthContextProfileDto {
  @ApiPropertyOptional({
    description:
      'Preferred locale. Use null to clear and follow the client default.',
    example: 'zh-CN',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string | null;

  @ApiPropertyOptional({
    description: 'Preferred timezone. Use null to clear.',
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
}

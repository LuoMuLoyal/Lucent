import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ValidateNested } from 'class-validator';

export class UpdateAiChatContextSettingsDto {
  @ApiPropertyOptional({
    description:
      'Allow AI chat to read stored health profile, allergies, and conditions.',
  })
  @IsOptional()
  @IsBoolean()
  healthProfile?: boolean;

  @ApiPropertyOptional({
    description: 'Allow AI chat to read recent daily records.',
  })
  @IsOptional()
  @IsBoolean()
  dailyRecords?: boolean;

  @ApiPropertyOptional({
    description: 'Allow AI chat to read sleep records and summaries.',
  })
  @IsOptional()
  @IsBoolean()
  sleepRecords?: boolean;

  @ApiPropertyOptional({
    description:
      'Allow AI chat to read current medicines and medicine-box data.',
  })
  @IsOptional()
  @IsBoolean()
  currentMedicines?: boolean;
}

export class UpdateUserSettingsDto {
  @ApiPropertyOptional({
    description: 'Allow AI-generated summaries and advice.',
  })
  @IsOptional()
  @IsBoolean()
  aiSummariesEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Consent to share anonymized data for research.',
  })
  @IsOptional()
  @IsBoolean()
  dataSharingConsent?: boolean;

  @ApiPropertyOptional({
    description: 'Allow the authenticated user to use the AI chat feature.',
  })
  @IsOptional()
  @IsBoolean()
  aiChatEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Fine-grained permissions for what AI chat may read.',
    type: () => UpdateAiChatContextSettingsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAiChatContextSettingsDto)
  aiChatContext?: UpdateAiChatContextSettingsDto;
}

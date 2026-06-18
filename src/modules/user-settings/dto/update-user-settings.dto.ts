import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ValidateNested } from 'class-validator';

export class UpdateAssistantContextSettingsDto {
  @ApiPropertyOptional({
    description:
      'Allow the assistant to read stored health profile, allergies, and conditions.',
  })
  @IsOptional()
  @IsBoolean()
  healthProfile?: boolean;

  @ApiPropertyOptional({
    description: 'Allow the assistant to read recent daily records.',
  })
  @IsOptional()
  @IsBoolean()
  dailyRecords?: boolean;

  @ApiPropertyOptional({
    description: 'Allow the assistant to read sleep records and summaries.',
  })
  @IsOptional()
  @IsBoolean()
  sleepRecords?: boolean;

  @ApiPropertyOptional({
    description:
      'Allow the assistant to read current medicines and medicine-box data.',
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
    description: 'Allow the authenticated user to use the assistant feature.',
  })
  @IsOptional()
  @IsBoolean()
  assistantEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Allow the assistant to reuse persisted conversation history as cross-conversation memory.',
  })
  @IsOptional()
  @IsBoolean()
  assistantMemoryEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Fine-grained permissions for what the assistant may read.',
    type: () => UpdateAssistantContextSettingsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAssistantContextSettingsDto)
  assistantContext?: UpdateAssistantContextSettingsDto;
}

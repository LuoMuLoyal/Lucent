import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

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
}

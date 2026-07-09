import { ApiProperty } from '@nestjs/swagger';
import { SecurityPinSettingsDto } from '../../security-pin/dto/pin.dto';

export class AssistantContextSettingsDto {
  @ApiProperty({
    description:
      'Whether the assistant may read stored health profile, allergies, and conditions.',
  })
  healthProfile!: boolean;

  @ApiProperty({
    description: 'Whether the assistant may read recent daily records.',
  })
  dailyRecords!: boolean;

  @ApiProperty({
    description: 'Whether the assistant may read sleep records and summaries.',
  })
  sleepRecords!: boolean;

  @ApiProperty({
    description:
      'Whether the assistant may read current medicines and medicine-box data.',
  })
  currentMedicines!: boolean;
}

export class UserSettingsDataDto {
  @ApiProperty({ description: 'Allow AI-generated summaries and advice.' })
  aiSummariesEnabled!: boolean;

  @ApiProperty({
    description: 'Consent to share anonymized data for research.',
  })
  dataSharingConsent!: boolean;

  @ApiProperty({
    description: 'Allow the authenticated user to use the assistant feature.',
  })
  assistantEnabled!: boolean;

  @ApiProperty({
    description:
      'Allow the assistant to reuse persisted conversation history as cross-conversation memory.',
  })
  assistantMemoryEnabled!: boolean;

  @ApiProperty({
    description: 'Daily water intake target (number of glasses).',
    example: 8,
  })
  waterTargetCount!: number;

  @ApiProperty({
    description: 'Fine-grained assistant context permissions.',
    type: () => AssistantContextSettingsDto,
  })
  assistantContext!: AssistantContextSettingsDto;

  @ApiProperty({
    type: String,
    description: 'ISO-8601 timestamp of last update.',
    nullable: true,
  })
  updatedAt!: string | null;

  @ApiProperty({
    description: 'Security PIN status.',
    type: () => SecurityPinSettingsDto,
  })
  securityPin!: SecurityPinSettingsDto;
}

export class UserSettingsResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => UserSettingsDataDto })
  data!: UserSettingsDataDto;
}

import { ApiProperty } from '@nestjs/swagger';

export class AiChatContextSettingsDto {
  @ApiProperty({
    description:
      'Whether AI chat may read stored health profile, allergies, and conditions.',
  })
  healthProfile!: boolean;

  @ApiProperty({
    description: 'Whether AI chat may read recent daily records.',
  })
  dailyRecords!: boolean;

  @ApiProperty({
    description: 'Whether AI chat may read sleep records and summaries.',
  })
  sleepRecords!: boolean;

  @ApiProperty({
    description:
      'Whether AI chat may read current medicines and medicine-box data.',
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
    description: 'Allow the authenticated user to use the AI chat feature.',
  })
  aiChatEnabled!: boolean;

  @ApiProperty({
    description:
      'Allow AI chat to reuse persisted assistant history as cross-conversation memory.',
  })
  aiChatMemoryEnabled!: boolean;

  @ApiProperty({
    description: 'Fine-grained AI chat context permissions.',
    type: () => AiChatContextSettingsDto,
  })
  aiChatContext!: AiChatContextSettingsDto;

  @ApiProperty({
    type: String,
    description: 'ISO-8601 timestamp of last update.',
    nullable: true,
  })
  updatedAt!: string | null;
}

export class UserSettingsResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => UserSettingsDataDto })
  data!: UserSettingsDataDto;
}

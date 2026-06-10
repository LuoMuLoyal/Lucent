import { ApiProperty } from '@nestjs/swagger';

export class UserSettingsDataDto {
  @ApiProperty({ description: 'Allow AI-generated summaries and advice.' })
  aiSummariesEnabled!: boolean;

  @ApiProperty({
    description: 'Consent to share anonymized data for research.',
  })
  dataSharingConsent!: boolean;

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

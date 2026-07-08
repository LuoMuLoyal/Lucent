import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AssistantPreviewFieldDto {
  @ApiProperty()
  label!: string;

  @ApiProperty()
  value!: string;
}

class AssistantProposalTargetDto {
  @ApiProperty({
    enum: ['daily_record', 'user_settings', 'daily_record_draft'],
  })
  kind!: 'daily_record' | 'user_settings' | 'daily_record_draft';

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  recordId?: string;

  @ApiPropertyOptional({ type: [String] })
  settingKeys?: string[];

  @ApiPropertyOptional({ type: [String] })
  matchedBy?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  snapshot?: Record<string, unknown>;
}

export class AssistantProposedActionDto {
  @ApiProperty({
    description:
      'Ephemeral proposal identifier for this streamed assistant result.',
  })
  id!: string;

  @ApiProperty({
    enum: [
      'create_daily_record',
      'update_daily_record',
      'delete_daily_record',
      'update_user_settings',
    ],
  })
  type!:
    | 'create_daily_record'
    | 'update_daily_record'
    | 'delete_daily_record'
    | 'update_user_settings';

  @ApiProperty({ example: 'proposed' })
  status!: 'proposed';

  @ApiProperty({ example: true })
  confirmationRequired!: true;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  summary!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty({ type: () => AssistantPreviewFieldDto, isArray: true })
  previewFields!: AssistantPreviewFieldDto[];

  @ApiProperty({ type: () => AssistantProposalTargetDto })
  target!: AssistantProposalTargetDto;

  @ApiProperty({ type: [String] })
  constraints!: string[];

  @ApiProperty({
    description: 'ISO-8601 expiry timestamp for this proposal snapshot.',
  })
  expiresAt!: string;

  @ApiProperty({ example: 1 })
  payloadVersion!: 1;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Structured proposal payload. Shape depends on action type and must be confirmed by the client before any real write happens.',
  })
  payload!: unknown;
}

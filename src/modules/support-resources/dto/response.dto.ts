import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SUPPORT_RESOURCE_SCOPES = ['help', 'about'] as const;
export type SupportResourceScope = (typeof SUPPORT_RESOURCE_SCOPES)[number];

export const SUPPORT_RESOURCE_ACTION_TYPES = [
  'url',
  'phone',
  'internal',
] as const;
export type SupportResourceActionType =
  (typeof SUPPORT_RESOURCE_ACTION_TYPES)[number];

export class SupportResourceDto {
  @ApiProperty({ example: 'help-faq' })
  id!: string;

  @ApiProperty({
    enum: SUPPORT_RESOURCE_SCOPES,
    enumName: 'SupportResourceScope',
  })
  scope!: SupportResourceScope;

  @ApiProperty({ example: 'FAQ' })
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  titleKey!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  subtitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  subtitleKey!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  icon!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  actionUrl!: string | null;

  @ApiPropertyOptional({
    enum: SUPPORT_RESOURCE_ACTION_TYPES,
    enumName: 'SupportResourceActionType',
    nullable: true,
  })
  actionType!: SupportResourceActionType | null;

  @ApiProperty({ description: 'Whether the resource is currently available.' })
  available!: boolean;
}

export class SupportResourceListDataDto {
  @ApiProperty({ type: [SupportResourceDto] })
  items!: SupportResourceDto[];

  @ApiProperty({
    description: 'ISO-8601 timestamp of last reference data revision.',
  })
  updatedAt!: string;
}

export class SupportResourceListResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => SupportResourceListDataDto })
  data!: SupportResourceListDataDto;
}

export class AppInfoDataDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  minClientVersion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  latestVersion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  downloadUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  supportEmail!: string | null;
}

export class AppInfoResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => AppInfoDataDto })
  data!: AppInfoDataDto;
}

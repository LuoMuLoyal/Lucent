import { ApiProperty } from '@nestjs/swagger';
import { ClinicSummaryShareScopeDto } from './clinic-summary-response.dto.js';

/**
 * Share-management list response DTOs.
 *
 * Each item is the shaped read model of one persisted share — the plaintext
 * token is returned exactly once at creation and never persisted, so the list
 * payload deliberately carries no token/tokenHash field at any level.
 */

export class ClinicSummaryShareListItemDto {
  @ApiProperty({
    description:
      'Persisted share record id (used for revocation). Never a token.',
  })
  id!: string;

  @ApiProperty({ description: 'Creation time in ISO 8601 format.' })
  createdAt!: string;

  @ApiProperty({ description: 'Expiration time in ISO 8601 format.' })
  expiresAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Revocation time in ISO 8601 format, or null while the share is active.',
  })
  revokedAt!: string | null;

  @ApiProperty({ description: 'Number of successful public opens.' })
  accessCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'First access time in ISO 8601 format, or null when never opened.',
  })
  firstAccessedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Last access time in ISO 8601 format, or null when never opened.',
  })
  lastAccessedAt!: string | null;

  @ApiProperty({ type: () => ClinicSummaryShareScopeDto })
  scope!: ClinicSummaryShareScopeDto;

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'Share fields the link may expose.',
  })
  selectedFields!: string[];
}

export class ClinicSummaryShareListDataDto {
  @ApiProperty({
    type: () => ClinicSummaryShareListItemDto,
    isArray: true,
    description:
      'The caller shares, newest first (createdAt desc); revoked shares stay listed.',
  })
  items!: ClinicSummaryShareListItemDto[];
}

export class ClinicSummaryShareListResponseDto extends ClinicSummaryShareListDataDto {}

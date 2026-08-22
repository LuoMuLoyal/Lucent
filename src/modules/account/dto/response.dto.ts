import { ApiProperty } from '@nestjs/swagger';

class AccountIdentityDto {
  @ApiProperty({ description: 'Account identity ID.' })
  id!: string;

  @ApiProperty({ description: 'OAuth provider name.', example: 'wechat_web' })
  provider!: string;

  @ApiProperty({
    description: 'Provider email when the provider exposes one.',
    example: 'user@example.com',
    nullable: true,
    type: String,
  })
  email!: string | null;

  @ApiProperty({
    description: 'Provider email verification time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
    type: String,
  })
  emailVerifiedAt!: string | null;

  @ApiProperty({
    description: 'Identity linked time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
  })
  linkedAt!: string;
}

export class AccountDto {
  @ApiProperty({ description: 'User ID.' })
  id!: string;

  @ApiProperty({
    description: 'Account email. OAuth-only accounts may not have one.',
    example: 'user@example.com',
    nullable: true,
    type: String,
  })
  email!: string | null;

  @ApiProperty({
    description: 'Display nickname.',
    example: 'Lumi User',
    nullable: true,
    type: String,
  })
  nickname!: string | null;

  @ApiProperty({
    description: 'Avatar URL.',
    example: 'https://example.com/avatar.png',
    nullable: true,
    type: String,
  })
  avatar!: string | null;

  @ApiProperty({
    description: 'Account email verification time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
    type: String,
  })
  emailVerifiedAt!: string | null;

  @ApiProperty({ description: 'Whether the account has a local password.' })
  hasPassword!: boolean;

  @ApiProperty({
    description: 'Last login time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
    type: String,
  })
  lastLoginAt!: string | null;

  @ApiProperty({
    description: 'Linked third-party identities without provider user ids.',
    type: () => [AccountIdentityDto],
  })
  linkedIdentities!: AccountIdentityDto[];

  @ApiProperty({
    description: 'Created time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Updated time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
  })
  updatedAt!: string;
}

export class AccountResponseDto extends AccountDto {}

class AccountEmailDataDto {
  @ApiProperty({
    description: 'New email address.',
    example: 'new@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Email verification time in ISO 8601.',
    example: '2026-01-01T00:00:00.000Z',
  })
  emailVerifiedAt!: string;
}

export class AccountEmailResponseDto extends AccountEmailDataDto {}

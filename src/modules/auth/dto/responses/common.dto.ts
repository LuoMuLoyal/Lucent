import { ApiProperty } from '@nestjs/swagger';

/** 注册/简略用户信息 */
export class UserBriefDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({
    description: '邮箱地址，第三方账号可能为空',
    example: 'user@example.com',
    nullable: true,
  })
  email!: string | null;

  @ApiProperty({ description: '昵称', example: '小明', nullable: true })
  nickname!: string | null;

  @ApiProperty({ description: '邮箱是否已验证', example: true })
  emailVerified!: boolean;

  @ApiProperty({
    description: '创建时间 (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: string;
}

/** 登录/完整用户信息 */
export class UserFullDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({
    description: '邮箱地址，第三方账号可能为空',
    example: 'user@example.com',
    nullable: true,
  })
  email!: string | null;

  @ApiProperty({ description: '昵称', example: '小明', nullable: true })
  nickname!: string | null;

  @ApiProperty({
    description: '头像 URL',
    example: 'https://example.com/avatar.png',
    nullable: true,
  })
  avatar!: string | null;

  @ApiProperty({ description: '邮箱是否已验证', example: true })
  emailVerified!: boolean;

  @ApiProperty({
    description: '创建时间 (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '更新时间 (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  updatedAt!: string;
}

/** 令牌信息 */
export class TokensDto {
  @ApiProperty({ description: '访问令牌' })
  accessToken!: string;

  @ApiProperty({ description: '刷新令牌' })
  refreshToken!: string;

  @ApiProperty({ description: '访问令牌过期时间（秒）', example: 3600 })
  expiresIn!: number;
}

/** 冷却时间 + 提示消息 */
export class CooldownMessageDto {
  @ApiProperty({ description: '冷却时间（秒）', example: 60 })
  cooldown!: number;

  @ApiProperty({ description: '提示消息', example: '验证码已发送' })
  message!: string;
}

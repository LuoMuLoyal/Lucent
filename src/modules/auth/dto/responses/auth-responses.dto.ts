import { ApiProperty } from '@nestjs/swagger';
import {
  CooldownMessageDto,
  TokensDto,
  UserBriefDto,
  UserFullDto,
} from './common.dto';

// ── Inner data DTOs ────────────────────────────────────────────

/** 注册响应 data */
class RegisterDataDto {
  @ApiProperty({ type: () => UserBriefDto })
  user!: UserBriefDto;

  @ApiProperty({ type: () => TokensDto })
  tokens!: TokensDto;
}

/** 登录响应 data */
class LoginDataDto {
  @ApiProperty({ type: () => UserFullDto })
  user!: UserFullDto;

  @ApiProperty({ type: () => TokensDto })
  tokens!: TokensDto;
}

/** 验证邮箱响应 data */
class VerifyEmailDataDto {
  @ApiProperty({ description: '邮箱是否已验证', example: true })
  emailVerified!: boolean;
}

/** 修改邮箱响应 data */
class ChangeEmailDataDto {
  @ApiProperty({ description: '新邮箱地址', example: 'new@example.com' })
  email!: string;

  @ApiProperty({ description: '邮箱是否已验证', example: true })
  emailVerified!: boolean;
}

// ── Envelope response DTOs ─────────────────────────────────────

/** 通用成功响应（data 为 null）— logout / resetPassword / changePassword / deleteAccount */
export class SuccessResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({
    description: '数据',
    nullable: true,
    example: null,
    type: Object,
  })
  data!: null;
}

/** 注册响应 */
export class RegisterResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => RegisterDataDto })
  data!: RegisterDataDto;
}

/** 登录响应 */
export class LoginResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => LoginDataDto })
  data!: LoginDataDto;
}

/** 刷新令牌响应 */
export class RefreshResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => TokensDto })
  data!: TokensDto;
}

/** 发送验证码响应 */
export class SendVerificationCodeResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => CooldownMessageDto })
  data!: CooldownMessageDto;
}

/** 验证邮箱响应 */
export class VerifyEmailResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => VerifyEmailDataDto })
  data!: VerifyEmailDataDto;
}

/** 忘记密码响应 */
export class ForgotPasswordResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => CooldownMessageDto })
  data!: CooldownMessageDto;
}

/** 获取/更新当前用户信息响应 */
export class MeResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => UserFullDto })
  data!: UserFullDto;
}

/** 修改邮箱响应 */
export class ChangeEmailResponseDto {
  @ApiProperty({ description: '结果码', example: 0 })
  code!: number;

  @ApiProperty({ description: '提示消息', example: '' })
  message!: string;

  @ApiProperty({ type: () => ChangeEmailDataDto })
  data!: ChangeEmailDataDto;
}

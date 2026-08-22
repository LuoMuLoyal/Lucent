import { ApiProperty } from '@nestjs/swagger';
import {
  CooldownMessageDto,
  TokensDto,
  UserBriefDto,
  UserFullDto,
} from './auth-response-common.dto';

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

/** OAuth 授权地址响应 data */
class OAuthAuthorizeDataDto {
  @ApiProperty({ description: '第三方授权地址' })
  authorizeUrl!: string;

  @ApiProperty({ description: '本次授权 state' })
  state!: string;

  @ApiProperty({ description: 'state 过期时间（秒）', example: 600 })
  expiresIn!: number;

  @ApiProperty({
    description: '客户端回跳地址。桌面端 loopback 或可信 Web 回调登录时返回。',
    required: false,
    example: 'https://api.lumos.app/oauth/wechat',
  })
  callbackUri?: string;
}

/** 验证邮箱响应 data */
class VerifyEmailDataDto {
  @ApiProperty({ description: '邮箱是否已验证', example: true })
  emailVerified!: boolean;
}

/** 注册响应 */
export class RegisterResponseDto extends RegisterDataDto {}

/** 登录响应 */
export class LoginResponseDto extends LoginDataDto {}

/** OAuth 授权地址响应 */
export class OAuthAuthorizeResponseDto extends OAuthAuthorizeDataDto {}

/** 刷新令牌响应 */
export class RefreshResponseDto extends TokensDto {}

/** 发送验证码响应 */
export class SendVerificationCodeResponseDto extends CooldownMessageDto {}

/** 验证邮箱响应 */
export class VerifyEmailResponseDto extends VerifyEmailDataDto {}

/** 忘记密码响应 */
export class ForgotPasswordResponseDto extends CooldownMessageDto {}

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class OAuthAuthorizeDto {
  @ApiProperty({
    description:
      '授权完成后的客户端回跳地址。桌面端支持 loopback 地址，Web 端支持可信 CORS origin 下的 /login/oauth/wechat。',
    required: false,
    example: 'http://127.0.0.1:49152/oauth/wechat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUri?: string;
}

export class OAuthCallbackDto {
  @ApiProperty({ description: 'OAuth 授权码' })
  @IsString()
  @MaxLength(512)
  code!: string;

  @ApiProperty({ description: '授权时生成的 state' })
  @IsString()
  @MaxLength(512)
  state!: string;
}

export class OAuthCodeCallbackDto {
  @ApiProperty({ description: 'OAuth 授权码' })
  @IsString()
  @MaxLength(512)
  code!: string;
}

export class AppleOAuthCallbackDto {
  @ApiProperty({ description: 'Apple 登录返回的 identityToken (JWT)' })
  @IsString()
  @MaxLength(4096)
  identityToken!: string;

  @ApiProperty({
    description: 'Apple 登录返回的 authorizationCode（可选）',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  authorizationCode?: string;

  @ApiProperty({
    description: 'Apple 返回的 givenName（首次登录时返回）',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  givenName?: string;

  @ApiProperty({
    description: 'Apple 返回的 familyName（首次登录时返回）',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  familyName?: string;
}

export class QqOAuthCallbackDto {
  @ApiProperty({ description: 'QQ 授权码' })
  @IsString()
  @MaxLength(512)
  code!: string;

  @ApiProperty({ description: '授权时生成的 state' })
  @IsString()
  @MaxLength(512)
  state!: string;
}

export class QqOAuthAuthorizeDto {
  @ApiProperty({
    description: 'QQ 授权完成后的客户端回跳地址',
    required: false,
    example: 'http://127.0.0.1:49152/oauth/qq',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUri?: string;
}

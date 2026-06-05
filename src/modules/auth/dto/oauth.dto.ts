import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class OAuthAuthorizeDto {
  @ApiProperty({
    description: '授权完成后的客户端回跳地址。桌面端只支持 loopback 地址。',
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

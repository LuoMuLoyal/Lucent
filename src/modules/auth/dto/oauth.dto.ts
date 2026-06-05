import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

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

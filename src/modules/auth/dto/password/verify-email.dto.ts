import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Better Auth 邮件验证 token',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString({ message: 'token 必须是字符串' })
  @IsNotEmpty({ message: 'token 不能为空' })
  token!: string;
}

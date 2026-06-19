import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: '当前密码（有密码的用户使用此方式确认注销）',
    example: 'Passw0rd123',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password?: string;

  @ApiPropertyOptional({
    description: '邮箱验证码（OAuth-only 用户使用此方式确认注销）',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code?: string;
}

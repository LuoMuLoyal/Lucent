import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  IsEmailAddress,
  IsStrongPassword,
  IsVerificationCode,
} from '../../../../common/validators/auth.decorators.js';

export class RegisterDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmailAddress()
  email!: string;

  @ApiProperty({
    description: '密码（8-32位，需包含大小写字母和数字）',
    example: 'Passw0rd123',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ description: '邮箱验证码', example: '123456' })
  @IsVerificationCode({ exactLength: false })
  code!: string;

  @ApiPropertyOptional({ description: '昵称', example: '小明', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '昵称至少 1 个字符' })
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;
}

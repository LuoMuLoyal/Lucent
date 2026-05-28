import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email!: string;

  @ApiProperty({
    description: '验证码',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  @MinLength(6, { message: '验证码为 6 位' })
  @MaxLength(6, { message: '验证码为 6 位' })
  code!: string;

  @ApiProperty({
    description: '新密码（8-32位，需包含大小写字母和数字）',
    example: 'NewPassw0rd',
    minLength: 8,
    maxLength: 32,
  })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(8, { message: '密码至少 8 个字符' })
  @MaxLength(32, { message: '密码最多 32 个字符' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: '密码必须包含大写字母、小写字母和数字',
  })
  password!: string;
}

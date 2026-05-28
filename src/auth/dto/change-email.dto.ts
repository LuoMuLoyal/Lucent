import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangeEmailDto {
  @ApiProperty({ description: '当前邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '当前邮箱不能为空' })
  currentEmail!: string;

  @ApiProperty({ description: '新邮箱', example: 'newuser@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '新邮箱不能为空' })
  newEmail!: string;

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
}

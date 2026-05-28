import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email!: string;

  @ApiProperty({
    description: '密码（8-32位，需包含大小写字母和数字）',
    example: 'Passw0rd123',
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

  @ApiPropertyOptional({ description: '昵称', example: '小明', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;
}

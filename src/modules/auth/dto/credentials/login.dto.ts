import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmailAddress,
  IsStrongPassword,
  IsVerificationCode,
} from '../../../../common/validators/auth.decorators.js';

export class LoginDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmailAddress()
  email!: string;

  @ApiPropertyOptional({
    description: '密码（与验证码二选一）',
    example: 'Passw0rd123',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword({ optional: true })
  password?: string;

  @ApiPropertyOptional({
    description: '邮箱验证码（与密码二选一）',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsVerificationCode({ optional: true })
  code?: string;
}

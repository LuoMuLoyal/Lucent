import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmailAddress,
  IsStrongPassword,
  IsVerificationCode,
} from '../../../../common/validators/auth.decorators';

export class ResetPasswordDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmailAddress()
  email!: string;

  @ApiProperty({
    description: '验证码',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsVerificationCode()
  code!: string;

  @ApiProperty({
    description: '新密码（8-32位，需包含大小写字母和数字）',
    example: 'NewPassw0rd',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword({ messagePrefix: '新密码' })
  password!: string;
}

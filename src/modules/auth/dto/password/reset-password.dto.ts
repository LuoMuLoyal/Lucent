import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../../../common/validators/auth.decorators.js';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Better Auth 密码重置 token',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString({ message: 'token 必须是字符串' })
  @IsNotEmpty({ message: 'token 不能为空' })
  token!: string;

  @ApiProperty({
    description: '新密码（8-32位，需包含大小写字母和数字）',
    example: 'NewPassw0rd',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword({ messagePrefix: '新密码' })
  password!: string;
}

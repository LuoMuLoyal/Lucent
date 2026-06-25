import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmailAddress,
  IsStrongPassword,
  IsVerificationCode,
} from '../../../common/validators/auth.decorators';

export class SetPasswordDto {
  @ApiPropertyOptional({
    description: '邮箱（OAuth-only 用户尚无邮箱时必须提供，用于同时绑定邮箱）',
    example: 'user@example.com',
  })
  @IsEmailAddress({ optional: true })
  email?: string;

  @ApiProperty({ description: '发往邮箱的验证码', example: '123456' })
  @IsVerificationCode({ exactLength: false })
  code!: string;

  @ApiProperty({
    description: '新密码（8-32位，需包含大小写字母和数字）',
    example: 'NewPassw0rd',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword({ notEmptyMessage: '新密码不能为空' })
  password!: string;
}

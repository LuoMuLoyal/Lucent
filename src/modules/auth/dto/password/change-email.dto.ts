import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  IsEmailAddress,
  IsVerificationCode,
} from '../../../../common/validators/auth.decorators';

export class ChangeEmailDto {
  @ApiProperty({ description: '新邮箱', example: 'newuser@example.com' })
  @IsEmailAddress({ notEmptyMessage: '新邮箱不能为空' })
  newEmail!: string;

  @ApiProperty({
    description: '验证码',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsVerificationCode()
  code!: string;

  @ApiProperty({
    description: '当前密码（敏感操作再认证用）',
    example: 'Passw0rd123',
  })
  @IsString()
  @IsNotEmpty({ message: '当前密码不能为空' })
  password!: string;
}

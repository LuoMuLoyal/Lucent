import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmailAddress,
  IsVerificationCode,
} from '../../../common/validators/auth.decorators';

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
}

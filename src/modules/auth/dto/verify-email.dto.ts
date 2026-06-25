import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmailAddress,
  IsVerificationCode,
} from '../../../common/validators/auth.decorators';

export class VerifyEmailDto {
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
}

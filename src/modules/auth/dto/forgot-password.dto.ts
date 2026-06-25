import { ApiProperty } from '@nestjs/swagger';
import { IsEmailAddress } from '../../../common/validators/auth.decorators';

export class ForgotPasswordDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmailAddress()
  email!: string;
}

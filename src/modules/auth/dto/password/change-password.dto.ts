import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../../common/validators/auth.decorators';

export class ChangePasswordDto {
  @ApiProperty({ description: '当前密码', example: 'Passw0rd123' })
  @IsString()
  @IsNotEmpty({ message: '当前密码不能为空' })
  oldPassword!: string;

  @ApiProperty({
    description: '新密码（8-32位，需包含大小写字母和数字）',
    example: 'NewPassw0rd',
    minLength: 8,
    maxLength: 32,
  })
  @IsStrongPassword({ notEmptyMessage: '新密码不能为空' })
  newPassword!: string;
}

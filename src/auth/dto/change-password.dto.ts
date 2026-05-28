import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(8, { message: '密码至少 8 个字符' })
  @MaxLength(32, { message: '密码最多 32 个字符' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: '密码必须包含大写字母、小写字母和数字',
  })
  newPassword!: string;
}

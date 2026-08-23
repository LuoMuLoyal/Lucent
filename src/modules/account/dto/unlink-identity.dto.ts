import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnlinkIdentityDto {
  @ApiProperty({
    description: '当前密码（敏感操作再认证用）',
    example: 'Passw0rd123',
  })
  @IsString()
  @IsNotEmpty({ message: '当前密码不能为空' })
  password!: string;
}

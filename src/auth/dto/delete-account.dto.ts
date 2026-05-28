import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: '当前密码（确认注销）', example: 'Passw0rd123' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password!: string;
}

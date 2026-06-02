import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @ApiPropertyOptional({ description: '昵称', example: '小明', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;

  @ApiPropertyOptional({
    description: '头像 URL',
    example: 'https://example.com/avatar.png',
  })
  @IsOptional()
  @IsString()
  avatar?: string;
}

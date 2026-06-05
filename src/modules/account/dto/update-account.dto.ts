import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAccountDto {
  @ApiPropertyOptional({
    description: 'Display nickname. Send an empty string to clear it.',
    example: 'Lumi User',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;

  @ApiPropertyOptional({
    description: 'Avatar URL. Send an empty string to clear it.',
    example: 'https://example.com/avatar.png',
  })
  @IsOptional()
  @IsString()
  avatar?: string;
}

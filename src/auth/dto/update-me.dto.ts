import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PrepareFullstackRecordLaneDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(8, { message: '密码至少 8 个字符' })
  @MaxLength(32, { message: '密码最多 32 个字符' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: '密码必须包含大写字母、小写字母和数字',
  })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: '日期不能为空' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '日期必须是 YYYY-MM-DD',
  })
  date!: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: '昵称至少 1 个字符' })
  @MaxLength(20, { message: '昵称最多 20 个字符' })
  nickname?: string;
}

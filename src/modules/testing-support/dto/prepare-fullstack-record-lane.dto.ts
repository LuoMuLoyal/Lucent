import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  IsEmailAddress,
  IsStrongPassword,
} from '../../../common/validators/auth.decorators';

export class PrepareFullstackRecordLaneDto {
  @IsEmailAddress()
  email!: string;

  @IsStrongPassword()
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

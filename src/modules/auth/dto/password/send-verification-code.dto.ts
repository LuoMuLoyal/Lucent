import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { IsEmailAddress } from '../../../../common/validators/auth.decorators';

export const VERIFICATION_SCENES = [
  'register',
  'login',
  'change-email',
  'set-password',
  'delete-account',
] as const;

export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

export class SendVerificationCodeDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmailAddress()
  email!: string;

  @ApiProperty({
    description: '验证码场景',
    enum: VERIFICATION_SCENES,
    example: 'register',
  })
  @IsString()
  @IsNotEmpty({ message: 'scene 不能为空' })
  @IsIn(VERIFICATION_SCENES, { message: 'scene 取值不合法' })
  scene!: VerificationScene;
}

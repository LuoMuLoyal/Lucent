import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

export const VERIFICATION_SCENES = [
  'register',
  'login',
  'reset-password',
  'change-email',
] as const;

export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

export class SendVerificationCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'scene 不能为空' })
  @IsIn(VERIFICATION_SCENES, { message: 'scene 取值不合法' })
  scene!: VerificationScene;
}

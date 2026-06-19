import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

export const VERIFICATION_SCENES = [
  'register',
  'login',
  'reset-password',
  'change-email',
  'set-password',
  'delete-account',
] as const;

export type VerificationScene = (typeof VERIFICATION_SCENES)[number];

export class SendVerificationCodeDto {
  @ApiProperty({ description: '邮箱地址', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
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

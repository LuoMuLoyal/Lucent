import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ConfirmTwoFactorDto {
  @ApiProperty({ description: 'TOTP verification code', example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'TOTP code or recovery code', example: '123456' })
  @IsString()
  code!: string;

  @ApiProperty({
    description: 'Temporary token from login response',
    example: 'ZXhhbXBsZS10ZW1wLXRva2Vu',
  })
  @IsString()
  tempToken!: string;
}

export class TwoFactorSetupResponseDto {
  @ApiProperty({ description: 'TOTP secret for manual entry' })
  secret!: string;

  @ApiProperty({ description: 'otpauth:// URI for QR generation' })
  otpauthUrl!: string;

  @ApiProperty({ description: 'QR code as base64 data URL' })
  qrCodeDataUrl!: string;
}

export class TwoFactorConfirmResponseDto {
  @ApiProperty({ description: 'One-time recovery codes' })
  recoveryCodes!: string[];
}

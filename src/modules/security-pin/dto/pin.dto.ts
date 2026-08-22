import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const SECURITY_PIN_REGEX = /^\d{6}$/;

export class EnableSecurityPinDto {
  @ApiProperty({ description: '6-digit numeric PIN', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(SECURITY_PIN_REGEX, { message: 'PIN must be 6 digits' })
  pin!: string;
}

export class ChangeSecurityPinDto {
  @ApiProperty({ description: 'Current 6-digit PIN', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(SECURITY_PIN_REGEX, { message: 'PIN must be 6 digits' })
  oldPin!: string;

  @ApiProperty({ description: 'New 6-digit PIN', example: '654321' })
  @IsString()
  @Length(6, 6)
  @Matches(SECURITY_PIN_REGEX, { message: 'PIN must be 6 digits' })
  newPin!: string;
}

export class DisableSecurityPinDto {
  @ApiProperty({ description: 'Current 6-digit PIN', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(SECURITY_PIN_REGEX, { message: 'PIN must be 6 digits' })
  pin!: string;
}

export class VerifySecurityPinDto {
  @ApiProperty({ description: '6-digit PIN to verify', example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(SECURITY_PIN_REGEX, { message: 'PIN must be 6 digits' })
  pin!: string;
}

export class SecurityPinElevationDataDto {
  @ApiProperty({ description: 'Short-lived signed elevation token' })
  elevationToken!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the elevation token expires',
  })
  expiresAt!: string;
}

export class SecurityPinElevationResponseDto extends SecurityPinElevationDataDto {}

export class SecurityPinSettingsDto {
  @ApiProperty({ description: 'Whether a Security PIN is enabled' })
  enabled!: boolean;

  @ApiProperty({
    description: 'ISO-8601 timestamp of last PIN change, null if never set',
    nullable: true,
    type: String,
  })
  lastChangedAt!: string | null;
}

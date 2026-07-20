import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

enum DevicePlatform {
  ios = 'ios',
  android = 'android',
  web = 'web',
  windows = 'windows',
  macos = 'macos',
  linux = 'linux',
  watchos = 'watchos',
  other = 'other',
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Push notification token (FCM/APNs).' })
  @IsString()
  pushToken!: string;

  @ApiProperty({
    description: 'Device platform.',
    enum: DevicePlatform,
    enumName: 'UserDevicePlatform',
  })
  @IsEnum(DevicePlatform)
  platform!: string;

  @ApiPropertyOptional({ description: 'Human-readable device name.' })
  @IsOptional()
  @IsString()
  deviceName?: string;

  @ApiPropertyOptional({ description: 'User locale preference.' })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({ description: 'User timezone preference.' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Whether push notifications are enabled for this device.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;
}

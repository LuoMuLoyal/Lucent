import { ApiProperty } from '@nestjs/swagger';

export const ENVIRONMENT_DATA_SOURCES = ['static', 'live'] as const;
export type EnvironmentDataSource = (typeof ENVIRONMENT_DATA_SOURCES)[number];

export const POLLEN_LEVELS = ['low', 'medium', 'high'] as const;
export type PollenLevel = (typeof POLLEN_LEVELS)[number];

export const UV_LEVELS = [
  'low',
  'moderate',
  'high',
  'very_high',
  'extreme',
] as const;
export type UvLevel = (typeof UV_LEVELS)[number];

export const AIR_QUALITY_LEVELS = [
  'good',
  'moderate',
  'unhealthy_sensitive',
  'unhealthy',
  'very_unhealthy',
  'hazardous',
] as const;
export type AirQualityLevel = (typeof AIR_QUALITY_LEVELS)[number];

export class PollenIndicatorDto {
  @ApiProperty({ enum: POLLEN_LEVELS, enumName: 'PollenLevel' })
  level!: PollenLevel;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'grass',
  })
  primaryType!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 18,
  })
  value!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'grains/m3',
  })
  unit!: string | null;
}

export class UvIndicatorDto {
  @ApiProperty({ example: 6 })
  index!: number;

  @ApiProperty({ enum: UV_LEVELS, enumName: 'UvLevel' })
  level!: UvLevel;
}

export class AirQualityIndicatorDto {
  @ApiProperty({ example: 82 })
  aqi!: number;

  @ApiProperty({
    enum: AIR_QUALITY_LEVELS,
    enumName: 'AirQualityLevel',
  })
  level!: AirQualityLevel;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'pm2.5',
  })
  primaryPollutant!: string | null;
}

export class TemperatureIndicatorDto {
  @ApiProperty({ example: 24 })
  celsius!: number;

  @ApiProperty({ example: 26 })
  feelsLike!: number;
}

export class HumidityIndicatorDto {
  @ApiProperty({ example: 58 })
  percent!: number;
}

export class EnvironmentSnapshotDto {
  @ApiProperty({
    enum: ENVIRONMENT_DATA_SOURCES,
    enumName: 'EnvironmentDataSource',
    example: 'static',
  })
  dataSource!: EnvironmentDataSource;

  @ApiProperty({
    description: 'ISO-8601 timestamp for the static reference data refresh.',
    example: '2026-06-06T00:00:00.000Z',
  })
  updatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'China temperate latitude band',
  })
  regionHint!: string | null;

  @ApiProperty({ type: () => PollenIndicatorDto })
  pollen!: PollenIndicatorDto;

  @ApiProperty({ type: () => UvIndicatorDto })
  uv!: UvIndicatorDto;

  @ApiProperty({ type: () => AirQualityIndicatorDto })
  airQuality!: AirQualityIndicatorDto;

  @ApiProperty({ type: () => TemperatureIndicatorDto })
  temperature!: TemperatureIndicatorDto;

  @ApiProperty({ type: () => HumidityIndicatorDto })
  humidity!: HumidityIndicatorDto;
}

export class EnvironmentSnapshotResponseDto extends EnvironmentSnapshotDto {}

import { ApiProperty } from '@nestjs/swagger';

export const HEALTH_PROBE_TYPES = ['live', 'ready', 'deep'] as const;
export type HealthProbeType = (typeof HEALTH_PROBE_TYPES)[number];

export const HEALTH_OVERALL_STATUSES = ['ok', 'error'] as const;
export type HealthOverallStatus = (typeof HEALTH_OVERALL_STATUSES)[number];

export const HEALTH_COMPONENT_STATUSES = ['up', 'down'] as const;
export type HealthComponentStatus = (typeof HEALTH_COMPONENT_STATUSES)[number];

export class HealthAppInfoDto {
  @ApiProperty({ example: 'lucent' })
  name!: string;

  @ApiProperty({ example: 'test' })
  env!: string;

  @ApiProperty({ example: 12345 })
  pid!: number;

  @ApiProperty({ example: 321.5 })
  uptimeSeconds!: number;

  @ApiProperty({ example: 98_304_000 })
  memoryRssBytes!: number;

  @ApiProperty({ example: 41_943_040 })
  memoryHeapUsedBytes!: number;
}

export class HealthSummaryDto {
  @ApiProperty({ example: 2 })
  total!: number;

  @ApiProperty({ example: 2 })
  passed!: number;

  @ApiProperty({ example: 0 })
  failed!: number;
}

export class HealthComponentDto {
  @ApiProperty({ example: 'database' })
  name!: string;

  @ApiProperty({
    enum: HEALTH_COMPONENT_STATUSES,
    enumName: 'HealthComponentStatus',
    example: 'up',
  })
  status!: HealthComponentStatus;

  @ApiProperty({ example: true })
  critical!: boolean;

  @ApiProperty({ example: 4 })
  durationMs!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
  })
  error!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { backend: 'redis' },
  })
  details!: Record<string, unknown> | null;
}

export class HealthProbeDto {
  @ApiProperty({
    enum: HEALTH_PROBE_TYPES,
    enumName: 'HealthProbeType',
    example: 'ready',
  })
  probe!: HealthProbeType;

  @ApiProperty({
    enum: HEALTH_OVERALL_STATUSES,
    enumName: 'HealthOverallStatus',
    example: 'ok',
  })
  status!: HealthOverallStatus;

  @ApiProperty({
    example: '2026-06-13T11:00:00.000Z',
  })
  checkedAt!: string;

  @ApiProperty({ type: () => HealthAppInfoDto })
  app!: HealthAppInfoDto;

  @ApiProperty({ type: () => HealthSummaryDto })
  summary!: HealthSummaryDto;

  @ApiProperty({ type: () => HealthComponentDto, isArray: true })
  components!: HealthComponentDto[];
}

export class HealthResponseDto extends HealthProbeDto {}

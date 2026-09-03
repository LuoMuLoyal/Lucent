import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client.js';

/**
 * Max events per batch request. Bounded to keep requests small and to prevent
 * amplification; the client posts batches (plan: 批量上报有条数限制).
 */
export const MAX_PRODUCT_EVENTS_PER_REQUEST = 50;

/**
 * Max allowed skew of `occurredAt` into the future (24h). Keeps raw events
 * from being posted with far-future timestamps, which would never match the
 * 90-day retention cleanup (a hard privacy guarantee). Enforced in
 * `ProductEventsService` (typed 400), consistent with the repo's service-side
 * date-boundary validation convention.
 */
export const MAX_PRODUCT_EVENT_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * One privacy-minimal product event. Whitelist-only: the global ValidationPipe
 * (`whitelist: true, forbidNonWhitelisted: true`) rejects any field not
 * declared here — in particular a client-supplied `userId`, free text, or a
 * metadata JSON object. `userId` always comes from the session, never the body.
 */
export class CreateProductEventDto {
  @ApiProperty({
    enum: ProductEventName,
    enumName: 'ProductEventName',
    description: 'Fixed product event name — enums only, no free text.',
  })
  @IsEnum(ProductEventName)
  name!: ProductEventName;

  @ApiProperty({
    enum: ProductEventSurface,
    enumName: 'ProductEventSurface',
    description:
      "In-app surface where the event occurred; 'system' marks server-initiated events.",
  })
  @IsEnum(ProductEventSurface)
  surface!: ProductEventSurface;

  @ApiProperty({
    enum: ProductEventResult,
    enumName: 'ProductEventResult',
    description:
      'Health-event lifecycle events report the outcome semantics (improved/unchanged/worsened), all other events report success/failure.',
  })
  @IsEnum(ProductEventResult)
  result!: ProductEventResult;

  @ApiPropertyOptional({
    enum: HealthEventStatus,
    enumName: 'HealthEventStatus',
    description:
      'Lifecycle status — only health_event_started (active) / health_event_ended (ended) report it; other events omit it.',
  })
  @IsOptional()
  @IsEnum(HealthEventStatus)
  eventStatus?: HealthEventStatus;

  @ApiPropertyOptional({
    description:
      'Known server-side suggestion rule code (allowlisted, no free strings); unknown codes are rejected with 400.',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  suggestionRuleCode?: string;

  @ApiProperty({
    description: 'Client app version, e.g. 1.2.0.',
    maxLength: 32,
    example: '1.2.0',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  appVersion!: string;

  @ApiProperty({
    enum: UserDevicePlatform,
    enumName: 'UserDevicePlatform',
    description: 'Client platform.',
  })
  @IsEnum(UserDevicePlatform)
  platform!: UserDevicePlatform;

  @ApiProperty({
    description: 'Event time (ISO 8601). Retention scans this field (90 days).',
    example: '2026-08-14T02:00:00.000Z',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiProperty({
    description:
      'Client-generated id enabling retry idempotency — unique per user, so retried batches never double-insert.',
    maxLength: 64,
    example: 'uuid-or-ulid-1',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientEventId!: string;
}

/** Batch of product events — size-limited to MAX_PRODUCT_EVENTS_PER_REQUEST. */
export class CreateProductEventBatchDto {
  @ApiProperty({
    type: CreateProductEventDto,
    isArray: true,
    maxItems: MAX_PRODUCT_EVENTS_PER_REQUEST,
    description: `1..${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events per request.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCT_EVENTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => CreateProductEventDto)
  events!: CreateProductEventDto[];
}

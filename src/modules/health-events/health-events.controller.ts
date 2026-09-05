import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { HealthEventKind } from '#generated/prisma/client.js';
import { ProblemDetailsDto, formatDateOnly } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { createHealthEventSchema } from './dto/create-event.dto.js';
import type { CreateHealthEventDto } from './dto/create-event.dto.js';
import { endHealthEventSchema } from './dto/end-event.dto.js';
import type { EndHealthEventDto } from './dto/end-event.dto.js';
import {
  eventDateSchema,
  eventListQuerySchema,
} from './dto/event-list-query.dto.js';
import type { EventListQueryDto } from './dto/event-list-query.dto.js';
import {
  healthEventListResponseSchema,
  healthEventNullableResponseSchema,
  healthEventResponseSchema,
} from './dto/event-response.dto.js';
import type { HealthEventItemDto } from './dto/event-response.dto.js';
import { upsertHealthEventCheckInSchema } from './dto/upsert-check-in.dto.js';
import type { UpsertHealthEventCheckInDto } from './dto/upsert-check-in.dto.js';
import type {
  HealthEventCheckInRecord,
  HealthEventCoverageRecord,
  HealthEventRecord,
  HealthEventView,
} from './repositories/event.repository.js';
import { CheckInsService } from './services/check-ins.service.js';
import { EventsService } from './services/events.service.js';

/** Path id of a health event (format is validated downstream by the DB uuid). */
const healthEventIdSchema = z.string().min(1).describe('Health event id.');

@ApiTags('Health Events')
@ApiBearerAuth('access-token')
@Controller('health-events')
export class HealthEventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly checkInsService: CheckInsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Start a user-confirmed health event' })
  @ApiResponse({ status: 201, description: 'The created health event.' })
  @SerializeOptions({ schema: healthEventResponseSchema })
  @ApiResponse({
    status: 404,
    description: 'Related medicine or reason record not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'An active health event already exists',
    type: ProblemDetailsDto,
  })
  async create(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createHealthEventSchema })
    dto: CreateHealthEventDto,
  ) {
    const event = await unwrapResult(this.eventsService.create(user.sub, dto));
    return this.toItem(event);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the current active health event' })
  @ApiResponse({
    status: 200,
    description: 'The active health event, or null when none is active.',
  })
  @SerializeOptions({ schema: healthEventNullableResponseSchema })
  async active(
    @CurrentUser() user: UserPayload,
    @Query({ schema: eventListQuerySchema })
    query: EventListQueryDto = {},
  ) {
    const event = await this.eventsService.findActiveView(user.sub, query.date);
    return event == null ? null : this.toItem(event);
  }

  @Get()
  @ApiOperation({ summary: 'List the user health event history' })
  @ApiResponse({
    status: 200,
    description: 'The user health event history page.',
  })
  @SerializeOptions({ schema: healthEventListResponseSchema })
  async list(
    @CurrentUser() user: UserPayload,
    @Query({ schema: eventListQuerySchema })
    query: EventListQueryDto = {},
  ) {
    const result = await this.eventsService.listViews(user.sub, query.date);
    return {
      items: result.items.map((event) => this.toItem(event)),
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one user health event' })
  @ApiResponse({ status: 200, description: 'The health event.' })
  @SerializeOptions({ schema: healthEventResponseSchema })
  @ApiResponse({
    status: 403,
    description: 'Health event is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Health event not found',
    type: ProblemDetailsDto,
  })
  async get(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: healthEventIdSchema }) id: string,
    @Query({ schema: eventListQuerySchema })
    query: EventListQueryDto = {},
  ) {
    const event = await unwrapResult(
      this.eventsService.findByIdView(user.sub, id, query.date),
    );
    return this.toItem(event);
  }

  @Put(':id/check-ins/:date')
  @ApiOperation({ summary: 'Upsert a user-confirmed daily event check-in' })
  @ApiResponse({ status: 200, description: 'The updated health event.' })
  @SerializeOptions({ schema: healthEventResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid outcome or date, or event is not active',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Health event is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Health event not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Duplicate check-in for the same event and date (race)',
    type: ProblemDetailsDto,
  })
  async upsertCheckIn(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: healthEventIdSchema }) id: string,
    @Param('date', { schema: eventDateSchema }) date: string,
    @Body({ schema: upsertHealthEventCheckInSchema })
    dto: UpsertHealthEventCheckInDto,
  ) {
    await unwrapResult(
      this.checkInsService.upsertForDate(user.sub, id, date, dto),
    );
    const event = await unwrapResult(
      this.eventsService.findByIdView(user.sub, id, date),
    );
    return this.toItem(event);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'End a health event with an explicit outcome' })
  @ApiResponse({ status: 200, description: 'The ended health event.' })
  @SerializeOptions({ schema: healthEventResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid outcome or event already ended',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Health event is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Health event not found',
    type: ProblemDetailsDto,
  })
  async end(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: healthEventIdSchema }) id: string,
    @Body({ schema: endHealthEventSchema }) dto: EndHealthEventDto,
  ) {
    await unwrapResult(this.eventsService.end(user.sub, id, dto));
    const event = await unwrapResult(
      this.eventsService.findByIdView(user.sub, id),
    );
    return this.toItem(event);
  }

  private toItem(
    event: HealthEventRecord | HealthEventView,
  ): HealthEventItemDto {
    const view = 'checkIn' in event ? event : this.withEmptyView(event);
    return {
      id: view.id,
      kind: view.kind ?? HealthEventKind.symptom,
      title: view.title,
      status: view.status,
      startedAt: this.toIso(view.startedAt),
      endedAt: view.endedAt == null ? null : this.toIso(view.endedAt),
      outcome: view.outcome,
      reasonRecordId: view.reasonRecordId,
      currentMedicineIds: [...view.currentMedicineIds],
      checkIn: view.checkIn == null ? null : this.toCheckIn(view.checkIn),
      coverage: this.toCoverage(view.coverage),
    };
  }

  private withEmptyView(event: HealthEventRecord): HealthEventView {
    return {
      ...event,
      checkIn: null,
      coverage: {
        checkInCount: 0,
        firstCheckInDate: null,
        lastCheckInDate: null,
      },
    };
  }

  private toCheckIn(checkIn: HealthEventCheckInRecord) {
    return {
      id: checkIn.id,
      eventId: checkIn.eventId,
      date: this.toDateOnly(checkIn.date),
      outcome: checkIn.outcome,
      createdAt: this.toIso(checkIn.createdAt),
      updatedAt: this.toIso(checkIn.updatedAt),
    };
  }

  private toCoverage(coverage: HealthEventCoverageRecord) {
    return {
      checkInCount: coverage.checkInCount,
      firstCheckInDate: this.toDateOnly(coverage.firstCheckInDate),
      lastCheckInDate: this.toDateOnly(coverage.lastCheckInDate),
    };
  }

  private toIso(value: Date | string): string;
  private toIso(value: Date | string | null | undefined): string | null;
  private toIso(value: Date | string | null | undefined): string | null {
    return value == null
      ? null
      : typeof value === 'string'
        ? value
        : value.toISOString();
  }

  private toDateOnly(value: Date | string): string;
  private toDateOnly(value: Date | string | null): string | null;
  private toDateOnly(value: Date | string | null): string | null {
    return value == null
      ? null
      : typeof value === 'string'
        ? value
        : formatDateOnly(value);
  }
}

// 201 主成功响应注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;POST /health-events 的 201 响应体同样按稳定组件名登记,导出脚本
// 支持 201 回写后自动生效。路径与导出的 OpenAPI 路径一致(模块挂在
// RouterModule `user` 前缀下,路径参数用 `{…}` 花括号形式)。
registerResponseSchema({
  path: '/api/v1/user/health-events',
  method: 'post',
  componentName: 'HealthEventResponse',
  schema: healthEventResponseSchema,
  description: 'The created health event.',
});

registerResponseSchema({
  path: '/api/v1/user/health-events/active',
  method: 'get',
  componentName: 'HealthEventNullableResponse',
  schema: healthEventNullableResponseSchema,
  description: 'The active health event, or null when none is active.',
});

registerResponseSchema({
  path: '/api/v1/user/health-events',
  method: 'get',
  componentName: 'HealthEventListResponse',
  schema: healthEventListResponseSchema,
  description: 'The user health event history page.',
});

registerResponseSchema({
  path: '/api/v1/user/health-events/{id}',
  method: 'get',
  componentName: 'HealthEventResponse',
  schema: healthEventResponseSchema,
  description: 'The health event.',
});

registerResponseSchema({
  path: '/api/v1/user/health-events/{id}/check-ins/{date}',
  method: 'put',
  componentName: 'HealthEventResponse',
  schema: healthEventResponseSchema,
  description: 'The updated health event.',
});

registerResponseSchema({
  path: '/api/v1/user/health-events/{id}/end',
  method: 'post',
  componentName: 'HealthEventResponse',
  schema: healthEventResponseSchema,
  description: 'The ended health event.',
});

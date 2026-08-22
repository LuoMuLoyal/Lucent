import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthEventKind } from '#generated/prisma/client';
import { formatDateOnly } from '../../common';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { CreateHealthEventDto } from './dto/create-event.dto';
import { EndHealthEventDto } from './dto/end-event.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';
import {
  HealthEventListResponseDto,
  HealthEventNullableResponseDto,
  HealthEventResponseDto,
  type HealthEventItemDto,
} from './dto/event-response.dto';
import { UpsertHealthEventCheckInDto } from './dto/upsert-check-in.dto';
import type {
  HealthEventCheckInRecord,
  HealthEventCoverageRecord,
  HealthEventRecord,
  HealthEventView,
} from './repositories/event.repository';
import { CheckInsService } from './services/check-ins.service';
import { EventsService } from './services/events.service';

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
  @ApiResponse({ status: 201, type: HealthEventResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateHealthEventDto,
  ) {
    const event = await this.eventsService.create(user.sub, dto);
    return this.toItem(event);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the current active health event' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-09' })
  @ApiResponse({ status: 200, type: HealthEventNullableResponseDto })
  async active(
    @CurrentUser() user: UserPayload,
    @Query() query: EventListQueryDto = new EventListQueryDto(),
  ) {
    const event = await this.eventsService.findActiveView(user.sub, query.date);
    return event == null ? null : this.toItem(event);
  }

  @Get()
  @ApiOperation({ summary: 'List the user health event history' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-09' })
  @ApiResponse({ status: 200, type: HealthEventListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query() query: EventListQueryDto = new EventListQueryDto(),
  ) {
    const result = await this.eventsService.listViews(user.sub, query.date);
    return {
      items: result.items.map((event) => this.toItem(event)),
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one user health event' })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-09' })
  @ApiResponse({ status: 200, type: HealthEventResponseDto })
  async get(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Query() query: EventListQueryDto = new EventListQueryDto(),
  ) {
    const event = await this.eventsService.findByIdView(
      user.sub,
      id,
      query.date,
    );
    return this.toItem(event);
  }

  @Put(':id/check-ins/:date')
  @ApiOperation({ summary: 'Upsert a user-confirmed daily event check-in' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'date', example: '2026-08-09' })
  @ApiResponse({ status: 200, type: HealthEventResponseDto })
  async upsertCheckIn(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Param('date') date: string,
    @Body() dto: UpsertHealthEventCheckInDto,
  ) {
    await this.checkInsService.upsertForDate(user.sub, id, date, dto);
    const event = await this.eventsService.findByIdView(user.sub, id, date);
    return this.toItem(event);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'End a health event with an explicit outcome' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: HealthEventResponseDto })
  async end(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: EndHealthEventDto,
  ) {
    await this.eventsService.end(user.sub, id, dto);
    const event = await this.eventsService.findByIdView(user.sub, id);
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

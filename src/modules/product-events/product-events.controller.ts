import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { CreateProductEventBatchDto } from './dto/create-product-event.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { FunnelResponseDto } from './dto/funnel-response.dto';
import { AdminGuard } from './guards/admin.guard';
import { ProductEventsService } from './services/events.service';
import { ProductFunnelService } from './services/funnel.service';

@ApiTags('Product Events')
@ApiBearerAuth('access-token')
@Controller('product-events')
export class ProductEventsController {
  constructor(
    private readonly eventsService: ProductEventsService,
    private readonly funnelService: ProductFunnelService,
  ) {}

  @Post()
  // Batch ingestion amplifies writes (up to MAX_PRODUCT_EVENTS_PER_REQUEST
  // events per request), so it gets a dedicated stricter limit on top of the
  // global throttler: 10 req/min caps the sustained write rate even though
  // the global 100 req/min would allow five times as many rows per minute.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: 'Record a batch of privacy-minimal product events',
    description:
      'Write-only ingestion for product measurement. userId always comes from the session — a client-supplied userId is rejected by the whitelist. Raw events are retained 90 days, then deleted.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Events accepted; `recorded` may be lower than `received` when duplicate clientEventIds were skipped.',
  })
  async recordBatch(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateProductEventBatchDto,
  ) {
    const result = await this.eventsService.recordBatch(user.sub, dto.events);
    return successEnvelope(result);
  }

  @Get('funnel')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin-only daily product funnel aggregation',
    description:
      'Internal admin surface (JWT email must match ADMIN_EMAIL; regular users get 403). Aggregates the core product loop per UTC calendar day — event started → suggestion impression/actioned → event ended/outcome → review opened — plus optional visit-summary events separately. Counts only: the response carries no health content, rule codes, user ids or per-user detail. Per-day details are suppressed below the small-sample threshold.',
  })
  @ApiResponse({
    status: 200,
    type: FunnelResponseDto,
    description: 'Aggregated funnel counts for the requested window.',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated but not the internal admin (ADMIN_EMAIL).',
  })
  async getFunnel(@Query() query: FunnelQueryDto) {
    return successEnvelope(await this.funnelService.getFunnel(query));
  }
}

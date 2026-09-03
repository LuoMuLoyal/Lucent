import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { createProductEventBatchSchema } from './dto/create-product-event.dto.js';
import type { CreateProductEventBatchDto } from './dto/create-product-event.dto.js';
import { productFunnelQuerySchema } from './dto/funnel-query.dto.js';
import type { FunnelQueryDto } from './dto/funnel-query.dto.js';
import { funnelResponseSchema } from './dto/funnel-response.dto.js';
import { AdminGuard } from './guards/admin.guard.js';
import { ProductEventsService } from './services/events.service.js';
import { ProductFunnelService } from './services/funnel.service.js';

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
  @ApiResponse({
    status: 400,
    type: ProblemDetailsDto,
    description:
      'Unknown suggestion rule code or occurredAt more than 24 hours in the future.',
  })
  async recordBatch(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createProductEventBatchSchema })
    dto: CreateProductEventBatchDto,
  ) {
    return await unwrapResult(
      this.eventsService.recordBatch(user.sub, dto.events),
    );
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
  @ApiResponse({
    status: 400,
    type: ProblemDetailsDto,
    description: 'Invalid funnel query window (dates or range).',
  })
  @SerializeOptions({ schema: funnelResponseSchema })
  async getFunnel(
    @Query({ schema: productFunnelQuerySchema }) query: FunnelQueryDto,
  ) {
    return await unwrapResult(this.funnelService.getFunnel(query));
  }
}

registerResponseSchema({
  path: '/api/v1/user/product-events/funnel',
  method: 'get',
  componentName: 'FunnelResponseDto',
  schema: funnelResponseSchema,
  description: 'Aggregated funnel counts for the requested window.',
});

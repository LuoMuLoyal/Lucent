import {
  Controller,
  Get,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { unwrapResult } from '../../common/result/index.js';
import { ProblemDetailsDto, registerResponseSchema } from '../../common/index.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminPermissionGuard } from './guards/admin-permission.guard.js';
import { RequirePermission } from './decorators/require-permission.decorator.js';
import {
  ProductFunnelService,
  funnelResponseSchema,
  productFunnelQuerySchema,
} from '../product-events/index.js';
import type { FunnelDataDto, FunnelQueryDto } from '../product-events/index.js';

/**
 * `GET /admin/metrics/funnel` — the management-console view of the product
 * loop. The aggregation itself belongs to `product-events`
 * (`ProductFunnelService`) and is reused verbatim from the pre-existing
 * `/user/product-events/funnel` endpoint; only the surface (path and
 * `metrics:read` permission) is admin-owned.
 *
 * This lives in its own module rather than `AdminModule` because
 * `ProductEventsModule` already imports `AdminModule` (its controller uses
 * `AdminGuard`) — putting the endpoint in `AdminModule` would make the two
 * modules import each other, and the repo currently has no module cycle.
 */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin/metrics')
@UseGuards(AdminGuard)
export class AdminMetricsController {
  constructor(private readonly funnel: ProductFunnelService) {}

  @Get('funnel')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('metrics:read')
  @SerializeOptions({ schema: funnelResponseSchema })
  @ApiOperation({
    operationId: 'getAdminMetricsFunnel',
    summary: 'Admin-only daily product funnel aggregation',
    description:
      'Aggregates the core product loop per UTC calendar day — event started → suggestion impression/actioned → event ended/outcome → review opened — plus optional visit-summary events separately. Counts only: the response carries no health content, rule codes, user ids or per-user detail. Per-day details are suppressed below the small-sample threshold.',
  })
  @ApiResponse({
    status: 200,
    description: 'Aggregated funnel counts for the requested window.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid funnel query window (dates or range).',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user without the metrics:read permission.',
    type: ProblemDetailsDto,
  })
  async getFunnel(
    @Query({ schema: productFunnelQuerySchema }) query: FunnelQueryDto,
  ): Promise<FunnelDataDto> {
    return await unwrapResult(this.funnel.getFunnel(query));
  }
}

registerResponseSchema({
  path: '/api/v1/admin/metrics/funnel',
  method: 'get',
  componentName: 'FunnelResponse',
  schema: funnelResponseSchema,
  description: 'Aggregated funnel counts for the requested window.',
});

import {
  Controller,
  Get,
  Param,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';

import { eventReviewListQuerySchema } from './dto/event-review-list-query.dto.js';
import type { EventReviewListQueryDto } from './dto/event-review-list-query.dto.js';
import {
  eventReviewListResponseSchema,
  eventReviewNullableResponseSchema,
  eventReviewResponseSchema,
} from './dto/event-review-response.dto.js';
import { EventReviewService } from './services/event-review/review.service.js';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class EventReviewController {
  constructor(private readonly eventReviewService: EventReviewService) {}

  @Get('reviews/current')
  @ApiOperation({ summary: 'Build the current event review' })
  @SerializeOptions({ schema: eventReviewNullableResponseSchema })
  async getCurrentReview(@CurrentUser() user: UserPayload) {
    return await this.eventReviewService.buildCurrent(user.sub);
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Event review history' })
  @SerializeOptions({ schema: eventReviewListResponseSchema })
  async listReviews(
    @CurrentUser() user: UserPayload,
    @Query({ schema: eventReviewListQuerySchema })
    query: EventReviewListQueryDto,
  ) {
    return await this.eventReviewService.list(user.sub, query);
  }

  @Get('reviews/:eventId')
  @ApiOperation({ summary: 'Rebuild and persist the event review' })
  @ApiParam({ name: 'eventId' })
  @SerializeOptions({ schema: eventReviewResponseSchema })
  async getEventReview(
    @CurrentUser() user: UserPayload,
    @Param('eventId') eventId: string,
  ) {
    return await this.eventReviewService.buildForEvent(user.sub, eventId);
  }
}

registerResponseSchema({
  path: '/api/v1/user/reports/reviews/current',
  method: 'get',
  componentName: 'EventReviewData',
  schema: eventReviewNullableResponseSchema,
  description:
    'The current event review, or null when the user has no event review.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/reviews',
  method: 'get',
  componentName: 'EventReviewListResponse',
  schema: eventReviewListResponseSchema,
  description: 'Paginated event review history.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/reviews/{eventId}',
  method: 'get',
  componentName: 'EventReviewResponse',
  schema: eventReviewResponseSchema,
  description: 'The event review for the requested event.',
});

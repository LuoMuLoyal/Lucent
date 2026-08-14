import { Body, Controller, Post } from '@nestjs/common';
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
import { ProductEventsService } from './services/events.service';

@ApiTags('Product Events')
@ApiBearerAuth('access-token')
@Controller('product-events')
export class ProductEventsController {
  constructor(private readonly eventsService: ProductEventsService) {}

  @Post()
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
}

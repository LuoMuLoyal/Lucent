import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { ProductEventsController } from './product-events.controller';
import { ProductEventsService } from './services/events.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductEventsController],
  providers: [ProductEventsService],
  exports: [ProductEventsService],
})
export class ProductEventsModule {}

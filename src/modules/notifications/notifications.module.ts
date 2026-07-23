import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { NotificationsService } from './services';
import { PushDeliveryService } from './services';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushDeliveryService],
  exports: [NotificationsService, PushDeliveryService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { NotificationsService } from './services/notifications.service';
import { PushDeliveryService } from './services/push-delivery.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushDeliveryService],
  exports: [NotificationsService, PushDeliveryService],
})
export class NotificationsModule {}

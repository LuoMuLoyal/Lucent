import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import type { JpushConfig } from '../../config/services/jpush.config.js';
import { PrismaModule } from '../../prisma/index.js';
import { NotificationsService } from './application/services/notifications.js';
import { JpushPushProvider } from './adapters/push/jpush.js';
import { PushDeliveryService } from './application/services/push-delivery.js';
import { NotificationsController } from './adapters/http/notifications.controller.js';
import { INotificationSender } from './application/ports/notification-sender.js';
import { Notifications } from './application/ports/notifications.js';
import { PrismaNotifications } from './infrastructure/persistence/notifications.js';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    PrismaNotifications,
    { provide: Notifications, useExisting: PrismaNotifications },
    NotificationsService,
    { provide: INotificationSender, useExisting: NotificationsService },
    {
      provide: JpushPushProvider,
      useFactory: (configService: ConfigService) =>
        new JpushPushProvider(
          configService.getOrThrow<JpushConfig>(ConfigKey.Jpush),
          configService.get<string>('NODE_ENV') ?? 'development',
        ),
      inject: [ConfigService],
    },
    {
      provide: PushDeliveryService,
      useFactory: (provider: JpushPushProvider) =>
        new PushDeliveryService(provider),
      inject: [JpushPushProvider],
    },
  ],
  exports: [NotificationsService, PushDeliveryService, INotificationSender],
})
export class NotificationsModule {}

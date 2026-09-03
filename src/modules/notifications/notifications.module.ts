import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import type { JpushConfig } from '../../config/services/jpush.config.js';
import { PrismaModule } from '../../prisma/index.js';
import { NotificationsService } from './services/notifications.service.js';
import { JpushPushProvider } from './services/jpush.provider.js';
import { PushDeliveryService } from './services/push-delivery.service.js';
import { NotificationsController } from './notifications.controller.js';
import { INotificationSender } from './ports/notification-sender.port.js';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
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

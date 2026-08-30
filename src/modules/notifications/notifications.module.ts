import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
import type { JpushConfig } from '../../config/services/jpush.config';
import { PrismaModule } from '../../prisma';
import { NotificationsService } from './services/notifications.service';
import { JpushPushProvider } from './services/jpush.provider';
import { PushDeliveryService } from './services/push-delivery.service';
import { NotificationsController } from './notifications.controller';
import { INotificationSender } from './ports/notification-sender.port';

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

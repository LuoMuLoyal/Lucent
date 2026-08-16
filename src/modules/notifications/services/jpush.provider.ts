import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { JpushConfig } from '../../../config/services/jpush.config';
import type { PushMessage, PushProvider } from './push-provider.port';
import { chunkArray, ResultCode } from '../../../common';

export const JPUSH_MAX_ALIASES_PER_REQUEST = 1000;

/** JPush push notification TTL: 24 hours (1 day) in seconds. */
const JPUSH_TIME_TO_LIVE_SECONDS = 24 * 60 * 60;

/** Sends notification payloads to JPush REST API v3 by user alias. */
@Injectable()
export class JpushPushProvider implements PushProvider {
  private readonly logger = new Logger(JpushPushProvider.name);
  readonly isConfigured: boolean;

  private readonly authorization: string;
  private readonly apiBaseUrl: string;
  private readonly apnsProduction: boolean;

  constructor(config: JpushConfig) {
    this.isConfigured =
      config.appKey.trim().length > 0 && config.masterSecret.trim().length > 0;
    if (!this.isConfigured && process.env['NODE_ENV'] === 'production') {
      this.logger.warn(
        'JPush is not configured — push delivery is silently disabled. Fill JPUSH_APP_KEY / JPUSH_MASTER_SECRET before the 0.1.0 release.',
      );
    }
    this.authorization = `Basic ${Buffer.from(
      `${config.appKey}:${config.masterSecret}`,
    ).toString('base64')}`;
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
    this.apnsProduction = config.apnsProduction;
  }

  async send(aliases: string[], message: PushMessage): Promise<void> {
    if (!this.isConfigured || aliases.length === 0) {
      return;
    }

    for (const batch of chunkArray(aliases, JPUSH_MAX_ALIASES_PER_REQUEST)) {
      await this.sendBatch(batch, message);
    }
  }

  private async sendBatch(
    aliases: string[],
    message: PushMessage,
  ): Promise<void> {
    const payload = {
      platform: ['android', 'ios'],
      audience: { alias: aliases },
      notification: {
        alert: message.body,
        android: {
          title: message.title,
          extras: message.data ?? {},
        },
        ios: {
          alert: { title: message.title, body: message.body },
          sound: 'default',
          badge: '+1',
          extras: message.data ?? {},
        },
      },
      options: {
        apns_production: this.apnsProduction,
        time_to_live: JPUSH_TIME_TO_LIVE_SECONDS,
      },
    };

    const response = await fetch(`${this.apiBaseUrl}/v3/push`, {
      method: 'POST',
      headers: {
        Authorization: this.authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: `JPush push failed: status=${String(response.status)}, body=${detail.slice(0, 500)}`,
      });
    }

    this.logger.debug(
      `JPush push sent: aliases=${String(aliases.length)}, title="${message.title}"`,
    );
  }
}

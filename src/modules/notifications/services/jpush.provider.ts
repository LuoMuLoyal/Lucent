import { Injectable, Logger } from '@nestjs/common';
import type { JpushConfig } from '../../../config/services/jpush.config';
import type { PushMessage, PushProvider } from './push-provider.port';

export const JPUSH_MAX_ALIASES_PER_REQUEST = 1000;

const JPUSH_TIME_TO_LIVE_SECONDS = 86_400;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

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

    for (const batch of chunk(aliases, JPUSH_MAX_ALIASES_PER_REQUEST)) {
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
      throw new Error(
        `JPush push failed: status=${String(response.status)}, body=${detail.slice(0, 500)}`,
      );
    }

    this.logger.debug(
      `JPush push sent: aliases=${String(aliases.length)}, title="${message.title}"`,
    );
  }
}

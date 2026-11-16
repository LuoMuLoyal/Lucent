/**
 * AMQP connectivity for cross-service events.
 *
 * Owns exactly three things: the connection, the topic exchange declaration, and
 * confident failure reporting. It knows nothing about domain events — that is
 * `RabbitMqPublisher`'s job.
 *
 * ## Degradation
 *
 * No `RABBITMQ_URL` means "no broker", not "crash", mirroring how `REDIS_URL`
 * gates BullMQ. Local development, unit tests and e2e run brokerless, and the
 * outbox keeps delivering in process. Callers check `isEnabled` rather than
 * assuming a connection exists.
 *
 * ## Topology
 *
 * One durable **topic** exchange. Routing keys are `<domain>.<action>` — the
 * exact shape of event names in `domain-events.ts`, so an event name *is* its
 * routing key and there is no second mapping to drift. Queues are never declared
 * here: a queue belongs to the service that consumes it.
 *
 * ## Errors are values, not exceptions
 *
 * Every operation returns a `Result` instead of throwing. amqplib's callbacks
 * reject with arbitrary values, and wrapping each call in try/catch would make
 * the surrounding code read as error plumbing. Converting once, at the boundary,
 * keeps callers linear.
 *
 * ## Recovery
 *
 * amqplib 2.x reconnects on its own. The cached handle is cleared on `close` so a
 * publish waits for recovery instead of using a dead object.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { fromPromise, type ResultAsync } from '../../common/result/index.js';
import {
  mapUnknownToDependencyFailure,
  type DomainFailure,
} from '../../common/result/index.js';

const DEFAULT_CONFIRM_TIMEOUT_SECONDS = 10;
const DEFAULT_EXCHANGE = 'lucent.events';
/** Milliseconds in one second, for converting the configured timeout. */
const MS_PER_SECOND = 1_000;

@Injectable()
export class RabbitMqConnection implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConnection.name);

  private readonly url: string | null;
  readonly exchangeName: string;
  readonly confirmTimeoutMs: number;

  private connection: amqp.ChannelModel | null = null;
  private connectPromise: Promise<amqp.ChannelModel | null> | null = null;
  private shuttingDown = false;

  constructor(configService: ConfigService) {
    const url = (configService.get<string>(EnvKey.RABBITMQ_URL) ?? '').trim();
    this.url = url.length > 0 ? url : null;
    this.exchangeName =
      (configService.get<string>(EnvKey.RABBITMQ_EXCHANGE) ?? '').trim() ||
      DEFAULT_EXCHANGE;

    const seconds = Number(
      configService.get<string>(EnvKey.RABBITMQ_CONFIRM_TIMEOUT_SECONDS) ??
        DEFAULT_CONFIRM_TIMEOUT_SECONDS,
    );
    this.confirmTimeoutMs =
      (Number.isFinite(seconds) && seconds > 0
        ? seconds
        : DEFAULT_CONFIRM_TIMEOUT_SECONDS) * MS_PER_SECOND;

    if (this.url == null) {
      this.logger.log(
        'RabbitMQ disabled; RABBITMQ_URL not configured (cross-service events stay in process)',
      );
    }
  }

  /** Whether a broker is configured at all. Callers check this first. */
  get isEnabled(): boolean {
    return this.url != null;
  }

  /**
   * A confirm channel over the shared connection.
   *
   * `null` means the transport is disabled. A rejected `Result` means the broker
   * was reachable-but-failing; the caller decides between retry and park.
   *
   * Confirm mode is what makes "published" mean "the broker owns it": a plain
   * channel resolves as soon as bytes reach the socket buffer.
   */
  createChannel(): ResultAsync<amqp.ConfirmChannel | null, DomainFailure> {
    if (this.url == null || this.shuttingDown) {
      return fromPromise(
        Promise.resolve<amqp.ConfirmChannel | null>(null),
        (error) => mapUnknownToDependencyFailure(error),
      );
    }
    return fromPromise(this.openChannel(), (error) =>
      mapUnknownToDependencyFailure(error, 'RabbitMQ channel unavailable'),
    );
  }

  private async openChannel(): Promise<amqp.ConfirmChannel | null> {
    const connection = await this.connectionOrNull();
    if (connection == null) {
      return null;
    }
    return connection.createConfirmChannel();
  }

  /**
   * Connects on first use; concurrent callers share one attempt.
   *
   * `null` means "transport disabled" only. A broker that is configured but
   * unreachable must **reject** — reporting it as `null` would make an outage
   * indistinguishable from "no broker configured", and the caller would skip
   * the event instead of retrying it.
   */
  private async connectionOrNull(): Promise<amqp.ChannelModel | null> {
    if (this.url == null || this.shuttingDown) {
      return null;
    }
    if (this.connection != null) {
      return this.connection;
    }
    this.connectPromise ??= this.connect();
    // Clear the cached attempt in a `finally` so a failed connect is retried by
    // the next caller instead of replaying the same rejection.
    return (this.connectPromise = this.connectPromise.finally(() => {
      this.connectPromise = null;
    }));
  }

  private async connect(): Promise<amqp.ChannelModel | null> {
    if (this.url == null) {
      return null;
    }
    const connection = await amqp.connect(this.url);
    this.connection = connection;

    connection.on('error', (error: Error) => {
      this.logger.error(
        `RabbitMQ connection error: ${error.message}`,
        error.stack,
      );
    });
    connection.on('close', () => {
      this.connection = null;
      if (!this.shuttingDown) {
        this.logger.warn(
          'RabbitMQ connection closed; waiting for recovery or the next connect attempt',
        );
      }
    });

    // Declared once here so the topology lives in a single place. `durable` so
    // the exchange survives a broker restart.
    const channel = await connection.createChannel();
    await channel.assertExchange(this.exchangeName, 'topic', { durable: true });
    await channel.close();

    this.logger.log(
      `RabbitMQ connected; exchange "${this.exchangeName}" (topic, durable) ready`,
    );
    return connection;
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const connection = this.connection;
    this.connection = null;
    if (connection == null) {
      return;
    }
    // Shutdown must not throw while the process is already going down.
    const closed = await fromPromise(connection.close(), (error) =>
      mapUnknownToDependencyFailure(error),
    );
    if (closed.isErr()) {
      this.logger.warn(
        'RabbitMQ close during shutdown failed; process continues shutting down',
      );
    }
  }
}

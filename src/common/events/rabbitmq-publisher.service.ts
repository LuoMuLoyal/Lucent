/**
 * Publishes cross-service domain events to RabbitMQ.
 *
 * ## Why a second transport
 *
 * BullMQ already carries commands: work with exactly one executor that needs
 * retries, concurrency limits and a progress panel. RabbitMQ carries **facts** —
 * an event may have no consumers today and five tomorrow, and each subscribing
 * service receives it without the producer knowing who they are. The boundary is
 * mechanical: a queue name never leaves its owning service; anything crossing a
 * service boundary goes through here.
 *
 * ## Delivery contract
 *
 * - **Durable and persistent.** `RabbitMqConnection` declares a durable topic
 *   exchange; each message is published with `persistent: true`.
 * - **Publisher confirms on.** `publish()` resolves only once the broker takes
 *   responsibility. Without confirms "published" means "in the socket buffer",
 *   which is indistinguishable from loss when the broker is down.
 * - **At-least-once, never exactly-once.** A confirm timeout or connection loss
 *   can deliver the same event twice; consumers dedupe on `eventId`, the rule the
 *   outbox already states.
 *
 * Routing key is `<domain>.<action>` — identical to the event name, so a consumer
 * wanting every daily-record event binds `daily-record.*` and one wanting a
 * single fact binds the full key. No mapping table to drift.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';
import {
  errAsync,
  fromPromise,
  okAsync,
  type ResultAsync,
} from '../../common/result/index.js';
import {
  createDomainFailure,
  mapUnknownToDependencyFailure,
  type DomainFailure,
} from '../../common/result/index.js';
import type { DomainEventEnvelope } from './domain-events.js';
import { RabbitMqConnection } from './rabbitmq-connection.service.js';

/** Milliseconds in one second, for the AMQP `timestamp` header (seconds). */
const MS_PER_SECOND = 1_000;

/** An envelope plus the event's own fields, as it lands in the broker. */
export interface RabbitMqEventMessage extends Record<string, unknown> {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
}

@Injectable()
export class RabbitMqPublisher {
  private readonly logger = new Logger(RabbitMqPublisher.name);

  constructor(private readonly connection: RabbitMqConnection) {}

  /** Whether a broker is configured. Callers check this before building payloads. */
  get isEnabled(): boolean {
    return this.connection.isEnabled;
  }

  /**
   * Publishes one event under `routingKey`.
   *
   * A disabled transport is **not** an error — it is the normal brokerless state,
   * reported as `ok(false)` so callers skip the work without logging noise. A
   * broker that is configured but failing is a `dependency` failure, which is
   * what the outbox retries on.
   */
  publish(
    routingKey: string,
    message: RabbitMqEventMessage,
    headers?: Record<string, unknown>,
  ): ResultAsync<boolean, DomainFailure> {
    if (!this.connection.isEnabled) {
      return okAsync(false);
    }

    return this.connection
      .createChannel()
      .andThen((channel) => {
        if (channel == null) {
          return okAsync(false);
        }
        return this.publishConfirmed(channel, routingKey, message, headers).map(
          () => true,
        );
      })
      .andThen((published) => {
        if (published) {
          this.logger.debug(
            `Published ${message.eventType} (${message.eventId}) to "${routingKey}"`,
          );
        }
        return okAsync(published);
      });
  }

  /** Convenience wrapper for the envelope shape the outbox already produces. */
  publishEnvelope(
    envelope: DomainEventEnvelope & Record<string, unknown>,
  ): ResultAsync<boolean, DomainFailure> {
    return this.publish(envelope.eventType, envelope);
  }

  /**
   * Wraps `channel.publish` in a broker confirm, then closes the
   * short-lived channel.
   *
   * One channel per publish keeps a failed publish from poisoning later ones;
   * the connection (and amqplib's recovery) is the part worth reusing.
   *
   * The publish outcome is decided **before** the channel closes: a close error
   * says nothing about whether the broker accepted the message, so it must not
   * turn a successful publish into a failure (or hide one).
   */
  private publishConfirmed(
    channel: ConfirmChannel,
    routingKey: string,
    message: RabbitMqEventMessage,
    headers?: Record<string, unknown>,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.sendAndAwaitConfirm(channel, routingKey, message, headers),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          `RabbitMQ publish failed for ${message.eventType}`,
        ),
    ).andThen((value) =>
      // Close before returning; `closeChannel` reports instead of propagating,
      // so a close failure never masks the publish outcome.
      fromPromise(this.closeChannel(channel), (error) =>
        mapUnknownToDependencyFailure(error),
      ).map(() => value),
    );
  }

  /** Closes a publish channel, reporting rather than propagating a failure. */
  private async closeChannel(channel: ConfirmChannel): Promise<void> {
    const closed = await fromPromise(channel.close(), (error) => error);
    if (closed.isErr()) {
      this.logger.debug('Closing the publish channel failed; ignoring.');
    }
  }

  /**
   * The confirm round trip.
   *
   * The timeout matters: a broker that accepted the TCP connection but stopped
   * confirming would otherwise hang the outbox poller indefinitely.
   */
  private sendAndAwaitConfirm(
    channel: ConfirmChannel,
    routingKey: string,
    message: RabbitMqEventMessage,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error == null) {
          resolve();
        } else {
          reject(error);
        }
      };

      const timer = setTimeout(() => {
        finish(
          new Error(
            `Timed out after ${String(this.connection.confirmTimeoutMs)}ms waiting for a broker confirm`,
          ),
        );
      }, this.connection.confirmTimeoutMs);
      // Do not keep the process alive only for the confirm timer.
      timer.unref();

      channel.publish(
        this.connection.exchangeName,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: message.eventId,
          type: message.eventType,
          timestamp: Math.floor(Date.now() / MS_PER_SECOND),
          headers: {
            ...headers,
            'x-event-version': message.version,
            'x-occurred-at': message.occurredAt,
          },
        },
        (error: unknown) => {
          finish(error instanceof Error ? error : undefined);
        },
      );
    });
  }

  /** Exposed for callers that need to fail fast on a missing broker. */
  requireBroker(): ResultAsync<void, DomainFailure> {
    return this.connection.isEnabled
      ? okAsync(undefined)
      : errAsync(
          createDomainFailure({
            kind: 'dependency',
            code: 'DEPENDENCY_UNAVAILABLE',
            detail: 'RABBITMQ_URL is not configured',
          }),
        );
  }
}

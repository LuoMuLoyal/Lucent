import { Module } from '@nestjs/common';
import { RabbitMqConnection } from './rabbitmq-connection.service.js';
import { RabbitMqPublisher } from './rabbitmq-publisher.service.js';

/**
 * Cross-service event transport.
 *
 * Deliberately separate from `DomainEventsModule`: that module owns the outbox
 * and in-process fan-out, which must keep working with no broker at all. This
 * module adds the cross-service channel on top and degrades to "disabled" when
 * `RABBITMQ_URL` is absent, so importing it never forces a broker on a
 * developer, a unit test or an e2e run.
 *
 * Nothing consumes from RabbitMQ yet. This step only establishes the connection,
 * topology and confirmed publisher; wiring the outbox fan-out to it is a
 * separate change so it can be reviewed and rolled back on its own.
 */
@Module({
  providers: [RabbitMqConnection, RabbitMqPublisher],
  exports: [RabbitMqConnection, RabbitMqPublisher],
})
export class RabbitMqModule {}

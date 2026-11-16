import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';

// `vi.mock` is hoisted above imports, so the mock factory may only reference
// values created by `vi.hoisted`.
const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock('amqplib', () => ({
  // The service imports the namespace (`import * as amqp`), so the factory must
  // expose `connect` at the module level rather than under a `default`.
  connect: connectMock,
}));

const amqp = { connect: connectMock };

import { RabbitMqConnection } from './rabbitmq-connection.service.js';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function fakeConnection() {
  const channel = {
    assertExchange: vi.fn(),
    close: vi.fn(),
    createConfirmChannel: vi.fn(),
  };
  const connection = {
    createChannel: vi.fn().mockResolvedValue(channel),
    createConfirmChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn(),
    on: vi.fn(),
  };
  return { connection, channel };
}

describe('RabbitMqConnection', () => {
  it('is disabled with no URL and never touches the broker', async () => {
    const connection = new RabbitMqConnection(config({}));
    const channel = await connection.createChannel();

    expect(connection.isEnabled).toBe(false);
    expect(channel.isOk()).toBe(true);
    expect(channel._unsafeUnwrap()).toBeNull();
    expect(amqp.connect).not.toHaveBeenCalled();
  });

  it('declares a durable topic exchange on connect', async () => {
    const { connection: fake, channel } = fakeConnection();
    vi.mocked(amqp.connect).mockResolvedValue(
      fake as unknown as Awaited<ReturnType<typeof amqp.connect>>,
    );

    const connection = new RabbitMqConnection(
      config({ RABBITMQ_URL: 'amqp://localhost:5672' }),
    );
    await connection.createChannel();

    expect(amqp.connect).toHaveBeenCalledWith('amqp://localhost:5672');
    expect(channel.assertExchange).toHaveBeenCalledWith(
      'lucent.events',
      'topic',
      { durable: true },
    );
  });

  it('uses the configured exchange name', async () => {
    const { connection: fake, channel } = fakeConnection();
    vi.mocked(amqp.connect).mockResolvedValue(
      fake as unknown as Awaited<ReturnType<typeof amqp.connect>>,
    );

    const connection = new RabbitMqConnection(
      config({
        RABBITMQ_URL: 'amqp://localhost:5672',
        RABBITMQ_EXCHANGE: 'custom.events',
      }),
    );
    await connection.createChannel();

    expect(channel.assertExchange).toHaveBeenCalledWith(
      'custom.events',
      'topic',
      { durable: true },
    );
  });

  it('reuses one connection across calls', async () => {
    const { connection: fake } = fakeConnection();
    vi.mocked(amqp.connect).mockResolvedValue(
      fake as unknown as Awaited<ReturnType<typeof amqp.connect>>,
    );

    const connection = new RabbitMqConnection(
      config({ RABBITMQ_URL: 'amqp://localhost:5672' }),
    );
    await connection.createChannel();
    await connection.createChannel();

    expect(amqp.connect).toHaveBeenCalledTimes(1);
  });

  it('reports a dependency failure when the broker rejects the connection', async () => {
    vi.mocked(amqp.connect).mockRejectedValue(new Error('ECONNREFUSED'));

    const connection = new RabbitMqConnection(
      config({ RABBITMQ_URL: 'amqp://localhost:5672' }),
    );
    const channel = await connection.createChannel();

    expect(channel.isErr()).toBe(true);
    expect(channel._unsafeUnwrapErr().kind).toBe('dependency');
  });

  it('converts the configured confirm timeout to milliseconds', () => {
    const connection = new RabbitMqConnection(
      config({
        RABBITMQ_URL: 'amqp://localhost:5672',
        RABBITMQ_CONFIRM_TIMEOUT_SECONDS: '3',
      }),
    );

    expect(connection.confirmTimeoutMs).toBe(3_000);
  });

  it('falls back to the default timeout for unusable values', () => {
    const connection = new RabbitMqConnection(
      config({
        RABBITMQ_URL: 'amqp://localhost:5672',
        RABBITMQ_CONFIRM_TIMEOUT_SECONDS: 'nope',
      }),
    );

    expect(connection.confirmTimeoutMs).toBe(10_000);
  });
});

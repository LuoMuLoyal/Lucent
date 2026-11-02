import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EnvKey } from '../config/env/env-keys.enum.js';

const DB_URL = 'postgresql://user:pass@localhost:5432/test';

function makeConfigService(
  overrides: Partial<Record<string, string | number | undefined>> = {},
): vi.Mocked<ConfigService> {
  const values: Record<string, string | number | undefined> = {
    [EnvKey.DATABASE_URL]: DB_URL,
    // Mirrors the zod validation backfill: unset → default.
    [EnvKey.SLOW_QUERY_THRESHOLD_MS]: '500',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) =>
      Object.hasOwn(values, key) ? values[key] : process.env[key],
    ),
    getOrThrow: vi.fn((key: string) => {
      const val = Object.hasOwn(values, key) ? values[key] : process.env[key];
      if (val === undefined) throw new Error(`Missing config: ${key}`);
      return val;
    }),
  } as unknown as vi.Mocked<ConfigService>;
}

// Mock PrismaClient and PrismaPg at module level
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const mockExtends = vi.fn().mockReturnValue({});

vi.mock('#generated/prisma/client', () => {
  return {
    PrismaClient: class MockPrismaClient {
      constructor(opts: unknown) {
        (this as unknown as { _opts: unknown })._opts = opts;
      }
      async $connect() {
        await mockConnect();
      }
      async $disconnect() {
        await mockDisconnect();
      }
      $on(event: string, cb: (e: unknown) => void) {
        mockOn(event, cb);
        return this;
      }
      $extends(): unknown {
        return mockExtends();
      }
    },
    Prisma: {
      defineExtension: (fn: unknown) => fn,
    },
  };
});

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class MockPrismaPg {
    connectionString: string;
    constructor(opts: { connectionString: string }) {
      this.connectionString = opts.connectionString;
    }
  },
}));

// The service logs slow queries through the substituted Nest logger, so the
// observable seam is `Logger.prototype.warn` rather than an injected mock.
const mockWarn = vi
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => {});

const mockExtendedClient = {
  user: { nonDeleted: { findMany: vi.fn(), findFirst: vi.fn() } },
  userDailyRecord: { nonDeleted: { findMany: vi.fn() } },
  userMedicineReminder: { nonDeleted: { findMany: vi.fn() } },
  userMedicineDoseLog: { nonDeleted: { findMany: vi.fn() } },
};

// Import after mocks are set up
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtends.mockReturnValue(mockExtendedClient);
  });

  describe('constructor', () => {
    it('creates instance with valid DATABASE_URL', () => {
      const configService = makeConfigService();
      const service = new PrismaService(configService);

      expect(configService.get).toHaveBeenCalledWith(EnvKey.DATABASE_URL);
      expect(service).toBeDefined();
    });

    it('throws when DATABASE_URL is undefined', () => {
      const configService = makeConfigService({
        [EnvKey.DATABASE_URL]: undefined,
      });

      expect(() => new PrismaService(configService)).toThrow(
        `Missing required environment variable: ${EnvKey.DATABASE_URL}`,
      );
    });

    it('passes adapter with connection string to PrismaClient', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/db';
      const configService = makeConfigService({
        [EnvKey.DATABASE_URL]: connStr,
      });

      const service = new PrismaService(configService);

      const opts = (
        service as unknown as {
          _opts: { adapter: { connectionString: string } };
        }
      )._opts;
      expect(opts.adapter).toBeDefined();
      expect(opts.adapter.connectionString).toBe(connStr);
    });

    it('passes warn, error, and query event log levels to PrismaClient', () => {
      const configService = makeConfigService();
      const service = new PrismaService(configService);

      const opts = (service as unknown as { _opts: { log: unknown[] } })._opts;
      expect(opts.log).toHaveLength(3);
    });

    it('registers a query event handler via $on', () => {
      const configService = makeConfigService();
      new PrismaService(configService);

      expect(mockOn).toHaveBeenCalledWith('query', expect.any(Function));
    });

    it('applies the soft-delete extension via $extends', () => {
      const configService = makeConfigService();
      new PrismaService(configService);

      expect(mockExtends).toHaveBeenCalledTimes(1);
    });
  });

  describe('nonDeleted getter', () => {
    it('exposes nonDeleted namespaces for the 4 soft-delete models', () => {
      const configService = makeConfigService();
      const service = new PrismaService(configService);

      expect(service.nonDeleted.user).toBeDefined();
      expect(service.nonDeleted.userDailyRecord).toBeDefined();
      expect(service.nonDeleted.userMedicineReminder).toBeDefined();
      expect(service.nonDeleted.userMedicineDoseLog).toBeDefined();
    });
  });

  describe('onModuleInit', () => {
    it('calls $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is not set', async () => {
      const configService = makeConfigService();
      Reflect.deleteProperty(
        process.env,
        EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT,
      );

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('skips $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is "true"', async () => {
      const configService = makeConfigService();
      process.env[EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT] = 'true';

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).not.toHaveBeenCalled();

      Reflect.deleteProperty(
        process.env,
        EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT,
      );
    });

    it('calls $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is "false"', async () => {
      const configService = makeConfigService();
      process.env[EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT] = 'false';

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);

      Reflect.deleteProperty(
        process.env,
        EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT,
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('calls $disconnect', async () => {
      const configService = makeConfigService();
      const service = new PrismaService(configService);
      await service.onModuleDestroy();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('slow query logging', () => {
    it('logs a structured warning when query duration exceeds threshold', () => {
      const configService = makeConfigService({
        [EnvKey.SLOW_QUERY_THRESHOLD_MS]: '100',
      });

      new PrismaService(configService);

      // Retrieve the handler registered with $on
      const handlerCall = mockOn.mock.calls.find(
        ([event]) => event === 'query',
      );
      expect(handlerCall).toBeDefined();
      const handler = handlerCall?.[1] as (e: {
        duration: number;
        query: string;
        target: string;
      }) => void;

      // Simulate a slow query event
      handler({
        duration: 150,
        query: 'SELECT * FROM users WHERE id = $1',
        target: 'pg',
      });

      // pino-native order: metadata first, message second.
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 150,
          query: 'SELECT * FROM users WHERE id = $1',
        }),
        'Slow query detected',
      );
    });

    it('does not log when query duration is below threshold', () => {
      const configService = makeConfigService({
        [EnvKey.SLOW_QUERY_THRESHOLD_MS]: 500,
      });

      new PrismaService(configService);

      const handlerCall = mockOn.mock.calls.find(
        ([event]) => event === 'query',
      );
      const handler = handlerCall?.[1] as (e: {
        duration: number;
        query: string;
        target: string;
      }) => void;

      handler({
        duration: 100,
        query: 'SELECT 1',
        target: 'pg',
      });

      expect(mockWarn).not.toHaveBeenCalled();
    });
  });
});

import type { ConfigService } from '@nestjs/config';
import { EnvKey } from '../config/env-keys.enum.js';

// Mock PrismaClient and PrismaPg at module level
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

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

// Import after mocks are set up
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let configService: vi.Mocked<ConfigService>;

  beforeEach(() => {
    vi.clearAllMocks();
    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;
  });

  describe('constructor', () => {
    it('creates instance with valid DATABASE_URL', () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/test',
      );

      const service = new PrismaService(configService);

      expect(configService.get).toHaveBeenCalledWith(EnvKey.DATABASE_URL);
      expect(service).toBeDefined();
    });

    it('throws when DATABASE_URL is undefined', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => new PrismaService(configService)).toThrow(
        `Missing required environment variable: ${EnvKey.DATABASE_URL}`,
      );
    });

    it('passes adapter with connection string to PrismaClient', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/db';
      configService.get.mockReturnValue(connStr);

      const service = new PrismaService(configService);

      const opts = (
        service as unknown as {
          _opts: { adapter: { connectionString: string } };
        }
      )._opts;
      expect(opts.adapter).toBeDefined();
      expect(opts.adapter.connectionString).toBe(connStr);
    });

    it('passes warn and error log levels to PrismaClient', () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/db',
      );

      const service = new PrismaService(configService);

      const opts = (service as unknown as { _opts: { log?: string[] } })._opts;
      expect(opts.log).toEqual(['warn', 'error']);
    });
  });

  describe('onModuleInit', () => {
    it('calls $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is not set', async () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/test',
      );
      Reflect.deleteProperty(process.env, 'OPENAPI_EXPORT_SKIP_DB_CONNECT');

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('skips $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is "true"', async () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/test',
      );
      process.env[EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT] = 'true';

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).not.toHaveBeenCalled();

      Reflect.deleteProperty(process.env, 'OPENAPI_EXPORT_SKIP_DB_CONNECT');
    });

    it('calls $connect when OPENAPI_EXPORT_SKIP_DB_CONNECT is "false"', async () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/test',
      );
      process.env[EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT] = 'false';

      const service = new PrismaService(configService);
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);

      Reflect.deleteProperty(process.env, 'OPENAPI_EXPORT_SKIP_DB_CONNECT');
    });
  });

  describe('onModuleDestroy', () => {
    it('calls $disconnect', async () => {
      configService.get.mockReturnValue(
        'postgresql://user:pass@localhost:5432/test',
      );

      const service = new PrismaService(configService);
      await service.onModuleDestroy();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type ConfigService } from '@nestjs/config';

// Use vi.hoisted so the mocks are available when vi.mock factories run.
const { mockSetup, mockPoolEnd, mockConstructor, MockPostgresSaver } =
  vi.hoisted(() => {
    const mockSetup = vi.fn().mockResolvedValue(undefined);
    const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
    const mockConstructor = vi.fn();
    class MockPostgresSaver {
      constructor(pool: unknown, serde: unknown, options: unknown) {
        mockConstructor(pool, serde, options);
      }
      setup = mockSetup;
    }
    return { mockSetup, mockPoolEnd, mockConstructor, MockPostgresSaver };
  });

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: MockPostgresSaver,
}));

vi.mock('pg', () => ({
  Pool: vi.fn(
    class {
      end = mockPoolEnd;
    },
  ),
}));

import { AssistantCheckpointerService } from './checkpointer.js';

function buildService(databaseUrl: string | undefined, schema?: string) {
  const configService = {
    get: vi.fn((key: string) => {
      if (key === 'DATABASE_URL') return databaseUrl;
      if (key === 'LANGGRAPH_CHECKPOINTER_SCHEMA') return schema;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new AssistantCheckpointerService(configService);
}

describe('AssistantCheckpointerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when DATABASE_URL is missing', async () => {
    const service = buildService(undefined);
    await service.onModuleInit();
    expect(service.getSaver()).toBeNull();
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it('builds a PostgresSaver and runs setup()', async () => {
    const service = buildService('postgres://user:pw@localhost:5432/lucent');
    await service.onModuleInit();
    expect(service.getSaver()).not.toBeNull();
    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it('defaults the checkpoint schema to a schema other than public', async () => {
    const service = buildService('postgres://user:pw@localhost:5432/lucent');
    await service.onModuleInit();
    // The tables must not land in `public`, which belongs to prisma/models/**.
    expect(mockConstructor).toHaveBeenCalledWith(expect.anything(), undefined, {
      schema: 'langgraph',
    });
  });

  it('uses LANGGRAPH_CHECKPOINTER_SCHEMA when configured', async () => {
    const service = buildService(
      'postgres://user:pw@localhost:5432/lucent',
      'graph_state',
    );
    await service.onModuleInit();
    expect(mockConstructor).toHaveBeenCalledWith(expect.anything(), undefined, {
      schema: 'graph_state',
    });
  });

  it('falls back to null and closes the pool when setup() fails', async () => {
    mockSetup.mockRejectedValueOnce(new Error('connection refused'));
    const service = buildService('postgres://user:pw@localhost:5432/lucent');
    await service.onModuleInit();
    expect(service.getSaver()).toBeNull();
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it('releases the pool on module destroy', async () => {
    const service = buildService('postgres://user:pw@localhost:5432/lucent');
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(mockPoolEnd).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type ConfigService } from '@nestjs/config';

// Use vi.hoisted so the mocks are available when vi.mock factories run.
const { mockSetup, mockPoolEnd, MockPostgresSaver } = vi.hoisted(() => {
  const mockSetup = vi.fn().mockResolvedValue(undefined);
  const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
  class MockPostgresSaver {
    setup = mockSetup;
  }
  return { mockSetup, mockPoolEnd, MockPostgresSaver };
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

import { AssistantCheckpointerService } from './checkpointer.service.js';

function buildService(databaseUrl: string | undefined) {
  const configService = {
    get: vi.fn((key: string) =>
      key === 'DATABASE_URL' ? databaseUrl : undefined,
    ),
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

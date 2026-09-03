// Use vi.hoisted so the mock is available when vi.mock factory runs
const { mockEnsureTable, MockPGVectorStore } = vi.hoisted(() => {
  const mockEnsureTable = vi.fn().mockResolvedValue(undefined);
  class MockPGVectorStore {
    ensureTableInDatabase = mockEnsureTable;
  }
  return { mockEnsureTable, MockPGVectorStore };
});

vi.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: MockPGVectorStore,
}));

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(),
}));

import type { ConfigService } from '@nestjs/config';
import { VectorStoreFactory } from './vector-store.factory.js';

describe('VectorStoreFactory', () => {
  function createFactory(
    databaseUrl: string | undefined,
    hasEmbeddings: boolean,
  ): VectorStoreFactory {
    const mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'DATABASE_URL') return databaseUrl;
        return undefined;
      }),
    } as unknown as ConfigService;

    const mockLlmRuntime = {
      createEmbeddingModel: vi.fn(() => (hasEmbeddings ? ({} as never) : null)),
    } as unknown as VectorStoreFactory['llmRuntime'];

    return new VectorStoreFactory(mockConfig, mockLlmRuntime);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureTable.mockResolvedValue(undefined);
  });

  // ── getStore: returns null when not configured ──────────────────────────

  it('returns null when DATABASE_URL is not configured', async () => {
    const factory = createFactory(undefined, true);
    const store = await factory.getStore('test_table');
    expect(store).toBeNull();
  });

  it('returns null when embedding model is not configured', async () => {
    const factory = createFactory('postgresql://localhost/db', false);
    const store = await factory.getStore('test_table');
    expect(store).toBeNull();
  });

  // ── getStore: creates and caches store ──────────────────────────────────

  it('creates a PGVectorStore when both DB and embeddings are configured', async () => {
    const factory = createFactory('postgresql://localhost/db', true);
    const store = await factory.getStore('leaflets');

    expect(store).toBeDefined();
    expect(store).toBeInstanceOf(MockPGVectorStore);
    expect(mockEnsureTable).toHaveBeenCalled();
  });

  it('caches the store for subsequent calls with the same table name', async () => {
    const factory = createFactory('postgresql://localhost/db', true);

    const store1 = await factory.getStore('leaflets');
    const store2 = await factory.getStore('leaflets');

    expect(store1).toBe(store2);
    // ensureTableInDatabase should only be called once
    expect(mockEnsureTable).toHaveBeenCalledTimes(1);
  });

  it('creates separate stores for different table names', async () => {
    const factory = createFactory('postgresql://localhost/db', true);

    const store1 = await factory.getStore('leaflets');
    const store2 = await factory.getStore('drugbank');

    // ensureTable called once per table
    expect(mockEnsureTable).toHaveBeenCalledTimes(2);
    expect(store1).toBeDefined();
    expect(store2).toBeDefined();
  });

  // ── getStore: deduplicates concurrent initialisation ────────────────────

  it('deduplicates concurrent initialisation for the same table', async () => {
    const factory = createFactory('postgresql://localhost/db', true);

    // Fire two concurrent calls
    const [store1, store2] = await Promise.all([
      factory.getStore('concurrent_table'),
      factory.getStore('concurrent_table'),
    ]);

    expect(store1).toBe(store2);
    expect(mockEnsureTable).toHaveBeenCalledTimes(1);
  });
});

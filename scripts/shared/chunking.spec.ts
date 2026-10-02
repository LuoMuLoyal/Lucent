import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmbeddingStore, embedDocuments } from './chunking.ts';

/**
 * Pins the embedding store against the two defects found on 2026-10-02.
 *
 * **Defect 1 — dimension never sent.** `createEmbeddingStore` read three env
 * vars (key / base url / model) but not `AI_EMBEDDING_DIMENSION`, so it built
 * `OpenAIEmbeddings` without a `dimensions` field. Text embedding models
 * commonly support dynamic truncation and default to something else
 * (`text-embedding-v4` defaults to **1024**), while the runtime side
 * (`LlmRuntimeService.createEmbeddingModel`) *did* pass 768. Index written at
 * 1024, queried at 768 — the vectors are unreachable. The table was also
 * created without a declared dimension, which makes it an untyped `vector`
 * column that cannot back an HNSW index.
 *
 * **Defect 2 — failed batches were counted.** `embedDocuments` caught a batch
 * error, logged it, slept, and continued — while `embedded += batch.length`
 * sat inside the `try`, above the throw point. The run therefore printed a
 * total that included batches it had never written: the same
 * "reports full, drops rows" shape as the `db-upsert` remainder-batch bug.
 */

const ENV_KEYS = [
  'AI_EMBEDDING_API_KEY',
  'AI_EMBEDDING_BASE_URL',
  'AI_EMBEDDING_MODEL',
  'AI_EMBEDDING_DIMENSION',
  'DATABASE_URL',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.AI_EMBEDDING_API_KEY = 'test-key';
  process.env.AI_EMBEDDING_BASE_URL = 'https://example.invalid/v1';
  process.env.AI_EMBEDDING_MODEL = 'text-embedding-v4';
  process.env.AI_EMBEDDING_DIMENSION = '768';
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/db';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Loads chunking.ts with `@langchain/*` and `pg` replaced by recording stubs. */
async function loadWithStubs(options: {
  embeddingsCtor?: ReturnType<typeof vi.fn>;
  ensureTable?: ReturnType<typeof vi.fn>;
  createHnswIndex?: ReturnType<typeof vi.fn>;
}) {
  const embeddingsCtor =
    options.embeddingsCtor ?? vi.fn(function EmbeddingsStub() {});
  const ensureTable =
    options.ensureTable ?? vi.fn().mockResolvedValue(undefined);
  const createHnswIndex =
    options.createHnswIndex ?? vi.fn().mockResolvedValue(undefined);

  const poolQuery = vi.fn().mockResolvedValue({ rows: [{ count: '1' }] });

  vi.doMock('@langchain/openai', () => ({ OpenAIEmbeddings: embeddingsCtor }));
  vi.doMock('@langchain/pgvector', () => ({
    PGVectorStore: class {
      constructor(_embeddings: unknown, config: unknown) {
        this.config = config;
      }
      config: unknown;
      ensureTableInDatabase = ensureTable;
      createHnswIndex = createHnswIndex;
      addDocuments = vi.fn().mockResolvedValue(undefined);
    },
  }));
  vi.doMock('pg', () => ({
    Pool: class {
      query = poolQuery;
      end = vi.fn().mockResolvedValue(undefined);
    },
  }));

  const mod = await import('./chunking.ts');
  return { mod, embeddingsCtor, ensureTable, createHnswIndex };
}

describe('createEmbeddingStore — dimension must be declared and sent', () => {
  it('passes AI_EMBEDDING_DIMENSION to the embeddings client', async () => {
    const { mod, embeddingsCtor } = await loadWithStubs({});

    await mod.createEmbeddingStore('drugbank_passage_embeddings');

    expect(embeddingsCtor).toHaveBeenCalledTimes(1);
    expect(embeddingsCtor.mock.calls[0]?.[0]).toMatchObject({
      model: 'text-embedding-v4',
      dimensions: 768,
    });
  });

  it('declares the dimension on the table and builds the HNSW index', async () => {
    const { mod, ensureTable, createHnswIndex } = await loadWithStubs({});

    await mod.createEmbeddingStore('drugbank_passage_embeddings');

    // Both must receive the dimension: an untyped `vector` column cannot back
    // an HNSW index, and the index needs `embedding::vector(n)` specifically.
    expect(ensureTable).toHaveBeenCalledWith(768);
    expect(createHnswIndex).toHaveBeenCalledWith({ dimensions: 768 });
  });

  it('omits `dimensions` and warns when the variable is unset', async () => {
    delete process.env.AI_EMBEDDING_DIMENSION;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mod, embeddingsCtor, ensureTable } = await loadWithStubs({});

    await mod.createEmbeddingStore('t');

    expect(embeddingsCtor.mock.calls[0]?.[0]).not.toHaveProperty('dimensions');
    expect(ensureTable).toHaveBeenCalledWith(undefined);
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a non-numeric dimension instead of silently degrading', async () => {
    process.env.AI_EMBEDDING_DIMENSION = 'not-a-number';
    const { mod } = await loadWithStubs({});

    await expect(mod.createEmbeddingStore('t')).rejects.toThrow(
      /AI_EMBEDDING_DIMENSION must be an integer/,
    );
  });

  it('returns null when the embedding role is not configured', async () => {
    delete process.env.AI_EMBEDDING_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mod } = await loadWithStubs({});

    await expect(mod.createEmbeddingStore('t')).resolves.toBeNull();
  });
});

describe('embedDocuments — counts must match what was written', () => {
  function docs(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      pageContent: `chunk ${String(i)}`,
      metadata: { i },
    }));
  }

  it('retries a failing batch and succeeds within the attempt budget', async () => {
    const addDocuments = vi
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const embedded = await embedDocuments({ addDocuments }, docs(4), 4);

    expect(embedded).toBe(4);
    expect(addDocuments).toHaveBeenCalledTimes(2);
  });

  it('throws when a batch keeps failing, reporting the honest prefix count', async () => {
    const addDocuments = vi
      .fn()
      .mockResolvedValueOnce(undefined) // batch 1 of 2 succeeds
      .mockRejectedValue(new Error('provider down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(embedDocuments({ addDocuments }, docs(4), 2)).rejects.toThrow(
      /2\/4 chunks were embedded before the failure/,
    );
  });

  it('never returns a total that includes failed batches', async () => {
    const addDocuments = vi.fn().mockRejectedValue(new Error('always down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // The old implementation resolved with the full document count here.
    await expect(embedDocuments({ addDocuments }, docs(10), 5)).rejects.toThrow(
      /Embedding failed for batch/,
    );
  });

  it('short-circuits on an empty document list', async () => {
    const addDocuments = vi.fn();

    await expect(embedDocuments({ addDocuments }, [], 10)).resolves.toBe(0);
    expect(addDocuments).not.toHaveBeenCalled();
  });
});

describe('parseRebuildArgs — batch size must respect the provider cap', () => {
  it('defaults embedBatchSize to 10, not 20', async () => {
    const { parseRebuildArgs } = await import('./chunking.ts');

    // The provider rejects >10 with `400 InternalError.Algo.InvalidParameter:
    // batch size is invalid, it should not be larger than 10.`. The old
    // default of 20 made the very first embedding run fail.
    expect(parseRebuildArgs([]).embedBatchSize).toBe(10);
  });

  it('still honours an explicit --embed-batch-size', async () => {
    const { parseRebuildArgs } = await import('./chunking.ts');

    expect(parseRebuildArgs(['--embed-batch-size', '5']).embedBatchSize).toBe(
      5,
    );
  });
});

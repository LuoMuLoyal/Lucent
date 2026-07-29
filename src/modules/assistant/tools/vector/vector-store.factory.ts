/**
 * Shared factory for PGVectorStore instances used by the three assistant
 * vector-retrieval tools (leaflet, drugbank, medical-knowledge).
 *
 * Before this factory existed, each tool duplicated `vectorStore` + `initPromise`
 * + `createEmbeddings()` + `new PGVectorStore(...)` + `ensureTableInDatabase()`
 * (≈ 30 lines each), and each created its own `new OpenAIEmbeddings` — ignoring
 * the shared `LlmRuntimeService.createEmbeddingModel()` and opening three
 * separate pg connection pools.
 *
 * The factory:
 * - Reuses `LlmRuntimeService.createEmbeddingModel()` for embeddings.
 * - Shares a single pg connection string (from `DATABASE_URL`).
 * - Lazily creates and caches one `PGVectorStore` per table name.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { LlmRuntimeService } from '../../../../llm-runtime';
import { EnvKey } from '../../../../config/env/env-keys.enum';

/** Column layout shared by all three embedding tables. */
const VECTOR_COLUMNS = {
  idColumnName: 'id',
  vectorColumnName: 'embedding',
  contentColumnName: 'document',
  metadataColumnName: 'cmetadata',
} as const;

@Injectable()
export class VectorStoreFactory {
  private readonly logger = new Logger(VectorStoreFactory.name);
  private readonly connectionString: string | null;
  private readonly stores = new Map<string, PGVectorStore>();
  private readonly initPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly llmRuntime: LlmRuntimeService,
  ) {
    this.connectionString =
      this.configService.get<string>(EnvKey.DATABASE_URL) ?? null;
  }

  /**
   * Returns a lazily-initialised `PGVectorStore` for the given table, or `null`
   * when embedding or database is not configured.
   *
   * Multiple callers requesting the same table name receive the same instance.
   */
  getStore(tableName: string): Promise<PGVectorStore | null> {
    const existing = this.stores.get(tableName);
    if (existing) return Promise.resolve(existing);

    const inFlight = this.initPromises.get(tableName);
    if (inFlight) {
      return inFlight.then(() => this.stores.get(tableName) ?? null);
    }

    const promise = this.initializeStore(tableName);
    this.initPromises.set(tableName, promise);
    return promise.then(() => this.stores.get(tableName) ?? null);
  }

  private async initializeStore(tableName: string): Promise<void> {
    if (!this.connectionString) {
      this.logger.warn(
        `Skipping vector store init for "${tableName}": DATABASE_URL not configured`,
      );
      return;
    }

    const embeddings = this.llmRuntime.createEmbeddingModel();
    if (!embeddings) {
      this.logger.warn(
        `Skipping vector store init for "${tableName}": embedding model not configured`,
      );
      return;
    }

    const store = new PGVectorStore(embeddings, {
      postgresConnectionOptions: {
        connectionString: this.connectionString,
      },
      tableName,
      columns: VECTOR_COLUMNS,
      distanceStrategy: 'cosine',
    });

    await store.ensureTableInDatabase();
    this.stores.set(tableName, store);
    this.logger.log(`Vector store ready: ${tableName}`);
  }
}

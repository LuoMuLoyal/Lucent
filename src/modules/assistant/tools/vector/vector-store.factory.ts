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
import { PGVectorStore } from '@langchain/pgvector';
import { Client } from 'pg';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';

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

    // 维度必须显式传入：不传时列建成无维度 `vector`，HNSW 索引无法建立
    // （索引需要 `embedding::vector(n)` 这一具体类型），检索会退化为全表扫描。
    const dimensions = this.llmRuntime.embeddingDimension;
    await store.ensureTableInDatabase(dimensions ?? undefined);

    if (dimensions != null) {
      // createHnswIndex 内部吞掉异常只打 console.error，因此这里自己再确认一次
      // 索引真的建成了 —— 静默失败会让检索悄悄退化成全表扫描。
      await store.createHnswIndex({ dimensions });
      const indexed = await this.hasVectorIndex(tableName);
      if (!indexed) {
        this.logger.warn(
          `HNSW index missing on "${tableName}"; vector search will fall back to a sequential scan`,
        );
      }
    } else {
      this.logger.warn(
        `Embedding dimension unknown; skipping HNSW index on "${tableName}"`,
      );
    }

    this.stores.set(tableName, store);
    this.logger.log(`Vector store ready: ${tableName}`);
  }

  /**
   * Returns whether an HNSW index exists on the table's vector column.
   *
   * Used to surface `createHnswIndex`'s swallowed errors instead of letting a
   * missing index pass silently.
   */
  private async hasVectorIndex(tableName: string): Promise<boolean> {
    if (!this.connectionString) {
      return false;
    }

    const client = new Client({ connectionString: this.connectionString });
    try {
      await client.connect();
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = $1
            AND indexdef ILIKE '%USING hnsw%'`,
        [tableName],
      );
      return Number(result.rows[0]?.count ?? '0') > 0;
    } catch (error) {
      this.logger.warn(
        `Could not verify HNSW index on "${tableName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      await client.end();
    }
  }
}

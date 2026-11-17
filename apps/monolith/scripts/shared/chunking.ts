import crypto from 'node:crypto';

const DEFAULT_MAX_CHUNK_LENGTH = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;
const INSERT_BATCH_SIZE = 500;

/** 单批嵌入的最大尝试次数（首次 + 重试）。 */
const EMBED_MAX_ATTEMPTS = 3;
/** 重试退避基数：第 n 次重试等 `n * BASE` 毫秒（线性，指数在此规模上没必要）。 */
const EMBED_RETRY_BASE_MS = 1000;

/**
 * 默认嵌入批大小。
 *
 * 取 10 是因为**这是 provider 的硬上限，不是调优参数**：百炼
 * `text-embedding-v4` 超过 10 直接返回
 * `400 InternalError.Algo.InvalidParameter: batch size is invalid,
 * it should not be larger than 10.: input.contents`。
 * 旧默认值 20 会让首次运行必然失败（实测如此）。
 * 换 provider 后可上调，但先确认它的批量上限。
 */
const DEFAULT_EMBED_BATCH_SIZE = 10;

// ─── Text chunking ────────────────────────────────────────────

function splitByParagraphs(text) {
  return text
    .split(/\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function splitByLength(text, maxLength, overlap) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLength, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function chunkText(text, maxLength, overlap) {
  const paragraphs = splitByParagraphs(text);
  const chunks = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }
    chunks.push(...splitByLength(paragraph, maxLength, overlap));
  }

  return chunks;
}

/**
 * Normalizes a value for text chunking purposes.
 * Returns `null` for nullish values so callers can skip empty fields.
 * All other values are stringified via `String()` — this is intentional
 * because the output is used as text input to `chunkText()`, not for
 * database storage (db-upsert.ts has its own `normalizeValue` that
 * preserves primitive types for SQL parameter binding).
 */
function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

// ─── Source hashing ───────────────────────────────────────────

/**
 * Computes a short hash from source rows to detect content changes.
 * Each row should provide a stable identifier and an updated_at timestamp.
 */
function computeSourceHash(rows, idField, updatedAtField) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) {
    hash.update(String(row[idField]));
    const ts = row[updatedAtField];
    hash.update(
      ts instanceof Date ? ts.toISOString() : String(ts ?? row[idField]),
    );
  }
  return hash.digest('hex').slice(0, 16);
}

// ─── Batch insert ─────────────────────────────────────────────

/**
 * Inserts chunks in batches using ON CONFLICT upsert.
 *
 * @param {object} client  — pg Client
 * @param {string} tableName
 * @param {string[]} columns
 * @param {string[]} conflictColumns
 * @param {string[]} updateColumns
 * @param {object[]} chunks
 * @returns {Promise<number>} total inserted count
 */
async function insertChunksBatch(
  client,
  tableName,
  columns,
  conflictColumns,
  updateColumns,
  chunks,
) {
  if (chunks.length === 0) {
    return 0;
  }

  const sqlIdentifier = (name) => `"${name.replace(/"/g, '""')}"`;
  let inserted = 0;

  for (let index = 0; index < chunks.length; index += INSERT_BATCH_SIZE) {
    const batch = chunks.slice(index, index + INSERT_BATCH_SIZE);
    const placeholders = [];
    const values = [];

    for (let rowIndex = 0; rowIndex < batch.length; rowIndex += 1) {
      const rowPlaceholders = [];
      for (
        let columnIndex = 0;
        columnIndex < columns.length;
        columnIndex += 1
      ) {
        rowPlaceholders.push(`$${rowIndex * columns.length + columnIndex + 1}`);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
      for (const column of columns) {
        values.push(batch[rowIndex][column]);
      }
    }

    const updateAssignments = updateColumns.map(
      (col) => `${sqlIdentifier(col)} = EXCLUDED.${sqlIdentifier(col)}`,
    );

    const sql = `
      INSERT INTO ${sqlIdentifier(tableName)} (${columns.map(sqlIdentifier).join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (${conflictColumns.map(sqlIdentifier).join(', ')})
      DO UPDATE SET
        ${updateAssignments.join(', ')},
        "updated_at" = CURRENT_TIMESTAMP
    `;

    const result = await client.query(sql, values);
    inserted += result.rowCount;
  }

  return inserted;
}

// ─── Embedding ────────────────────────────────────────────────

/**
 * Creates a PGVectorStore from environment configuration.
 * Returns { store, pool } or null if embedding is not configured.
 *
 * 读的四个变量与运行时（`LlmRuntimeService.createEmbeddingModel` +
 * `VectorStoreFactory`）**必须一致**，否则灌进去的向量检索不出来：
 *
 * - `AI_EMBEDDING_DIMENSION` 必须读且必须透传给 `OpenAIEmbeddings`。
 *   文本向量模型普遍支持动态降维且**默认输出不等于你要的维度**
 *   （`text-embedding-v4` 支持 64–2048，不传 `dimensions` 时返回 **1024**）。
 *   只建表不声明维度会得到无类型 `vector` 列，运行时按 768 建 HNSW 索引，
 *   两侧对不上即报维度不匹配。运行时一直是透传的，脚本这边曾经漏掉。
 * - 维度也必须传给 `ensureTableInDatabase`，列才会建成 `vector(n)`——
 *   无类型列建不了 HNSW 索引，检索退化为全表扫描。
 */
async function createEmbeddingStore(tableName) {
  const apiKey = process.env.AI_EMBEDDING_API_KEY?.trim();
  const baseUrl = process.env.AI_EMBEDDING_BASE_URL?.trim();
  const model = process.env.AI_EMBEDDING_MODEL?.trim();

  if (!apiKey || !baseUrl || !model) {
    console.error(
      'Embedding is not configured. Set AI_EMBEDDING_API_KEY, AI_EMBEDDING_BASE_URL, and AI_EMBEDDING_MODEL.',
    );
    return null;
  }

  const rawDimension = process.env.AI_EMBEDDING_DIMENSION?.trim();
  const dimensions = rawDimension ? Number(rawDimension) : null;
  if (dimensions != null && !Number.isInteger(dimensions)) {
    throw new Error(
      `AI_EMBEDDING_DIMENSION must be an integer, got "${String(rawDimension)}".`,
    );
  }
  if (dimensions == null) {
    // 不中断：不是所有 provider 都需要显式维度。但这里必须响一声——静默按模型
    // 默认维度建表，正是"灌进去检索不出来"的成因。
    console.warn(
      'AI_EMBEDDING_DIMENSION is not set; the table will be created with an untyped vector column and no HNSW index.',
    );
  }

  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const { PGVectorStore } = await import('@langchain/pgvector');
  const { Pool } = await import('pg');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for embedding.');
  }

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    ...(dimensions != null ? { dimensions } : {}),
  });

  const pool = new Pool({ connectionString, max: 2 });

  const store = new PGVectorStore(embeddings, {
    pool,
    tableName,
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'embedding',
      contentColumnName: 'document',
      metadataColumnName: 'cmetadata',
    },
    distanceStrategy: 'cosine',
  });

  await store.ensureTableInDatabase(dimensions ?? undefined);

  if (dimensions != null) {
    // 与 VectorStoreFactory 一致：索引需要具体维度类型，缺了就退化成全表扫描。
    // createHnswIndex 内部吞异常只打 console.error，所以自己再确认一次。
    await store.createHnswIndex({ dimensions });
    const indexed = await hasVectorIndex(pool, tableName);
    if (!indexed) {
      console.warn(
        `HNSW index missing on "${tableName}"; vector search will fall back to a sequential scan.`,
      );
    }
  }

  return { store, pool };
}

/** 索引是否真的建成了——用于把 createHnswIndex 吞掉的失败暴露出来。 */
async function hasVectorIndex(pool, tableName) {
  try {
    const result = await pool.query(
      `SELECT count(*)::text AS count
         FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = $1
          AND indexdef ILIKE '%USING hnsw%'`,
      [tableName],
    );
    return Number(result.rows[0]?.count ?? '0') > 0;
  } catch (error) {
    console.warn(
      `Could not verify HNSW index on "${tableName}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Embeds documents in batches with progress logging and retry-on-error.
 *
 * 失败语义：单个批次最多重试 `EMBED_MAX_ATTEMPTS` 次；仍失败则**抛错中止**，
 * 不再像旧实现那样 `console.error` 一句就跳过。旧写法有两个问题——
 * 一是失败批次没重试（`sleep` 之后循环照走），二是计数把失败批次也算进去
 * （`embedded += batch.length` 在抛错点之前），于是最终打印的条数是虚的。
 * 这与 `db-upsert.ts` 曾经的"报满却丢行"是同一类缺陷。
 *
 * 至于"重试仍然失败要不要当作致命"——这里选择致命。嵌入是幂等且可重跑的，
 * 而带着空洞的索引在检索侧表现为"有些内容就是搜不到"，没有报错可循。
 *
 * @param {object} store  — PGVectorStore instance
 * @param {object[]} docs — Array of { pageContent, metadata }
 * @param {number} batchSize
 * @returns {Promise<number>} total embedded count
 */
async function embedDocuments(store, docs, batchSize) {
  if (docs.length === 0) {
    console.log('No chunks to embed.');
    return 0;
  }

  console.log(
    `Generating embeddings for ${docs.length} chunks (batch size: ${batchSize})...`,
  );

  let embedded = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    let lastError = null;

    for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt += 1) {
      try {
        await store.addDocuments(batch);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const waitMs = EMBED_RETRY_BASE_MS * attempt;
        console.error(
          `  Batch ${i}-${i + batch.length} failed (attempt ${attempt}/${EMBED_MAX_ATTEMPTS}): ${error instanceof Error ? error.message : error}`,
        );
        if (attempt < EMBED_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    if (lastError != null) {
      throw new Error(
        `Embedding failed for batch ${i}-${i + batch.length} after ${EMBED_MAX_ATTEMPTS} attempts; ${embedded}/${docs.length} chunks were embedded before the failure. Re-run to retry (embedded chunks are upserted by id, so repeats are harmless).`,
        { cause: lastError },
      );
    }

    embedded += batch.length;
    const pct = ((embedded / docs.length) * 100).toFixed(1);
    console.log(`  ${embedded}/${docs.length} (${pct}%)`);

    if (i + batchSize < docs.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return embedded;
}

// ─── Shared parseArgs for rebuild scripts ─────────────────────

function parseRebuildArgs(argv) {
  const options = {
    maxChunkLength: DEFAULT_MAX_CHUNK_LENGTH,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    sourceVersion: null,
    sourceLimit: null,
    dryRun: false,
    skipRebuild: false,
    embed: false,
    embedLimit: null,
    embedBatchSize: DEFAULT_EMBED_BATCH_SIZE,
    embedForce: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--max-chunk-length') {
      options.maxChunkLength =
        Number(argv[index + 1]) || DEFAULT_MAX_CHUNK_LENGTH;
      index += 1;
      continue;
    }
    if (part === '--chunk-overlap') {
      options.chunkOverlap = Number(argv[index + 1]) || DEFAULT_CHUNK_OVERLAP;
      index += 1;
      continue;
    }
    if (part === '--source-version') {
      options.sourceVersion = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (part === '--limit' || part === '--source-limit') {
      options.sourceLimit = Number(argv[index + 1]) || null;
      index += 1;
      continue;
    }
    if (part === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (part === '--skip-rebuild') {
      options.skipRebuild = true;
      continue;
    }
    if (part === '--embed') {
      options.embed = true;
      continue;
    }
    if (part === '--embed-limit') {
      options.embedLimit = Number(argv[index + 1]) || null;
      index += 1;
      continue;
    }
    if (part === '--embed-batch-size') {
      options.embedBatchSize =
        Number(argv[index + 1]) || DEFAULT_EMBED_BATCH_SIZE;
      index += 1;
      continue;
    }
    if (part === '--embed-force') {
      options.embedForce = true;
    }
  }

  return options;
}

export {
  DEFAULT_MAX_CHUNK_LENGTH,
  DEFAULT_CHUNK_OVERLAP,
  splitByParagraphs,
  splitByLength,
  chunkText,
  normalizeValue,
  computeSourceHash,
  insertChunksBatch,
  createEmbeddingStore,
  embedDocuments,
  parseRebuildArgs,
};

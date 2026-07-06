const crypto = require('node:crypto');

const DEFAULT_MAX_CHUNK_LENGTH = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;
const INSERT_BATCH_SIZE = 500;

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

  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const { PGVectorStore } =
    await import('@langchain/community/vectorstores/pgvector');
  const { Pool } = await import('pg');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for embedding.');
  }

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
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

  await store.ensureTableInDatabase();

  return { store, pool };
}

/**
 * Embeds documents in batches with progress logging and retry-on-error.
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

    try {
      await store.addDocuments(batch);
      embedded += batch.length;
      const pct = ((embedded / docs.length) * 100).toFixed(1);
      console.log(`  ${embedded}/${docs.length} (${pct}%)`);
    } catch (error) {
      console.error(
        `  Batch ${i}-${i + batch.length} failed: ${error instanceof Error ? error.message : error}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

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
    embedBatchSize: 20,
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
      options.embedBatchSize = Number(argv[index + 1]) || 20;
      index += 1;
      continue;
    }
    if (part === '--embed-force') {
      options.embedForce = true;
    }
  }

  return options;
}

module.exports = {
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

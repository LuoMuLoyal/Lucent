#!/usr/bin/env node

/**
 * Rebuilds the DrugBank RAG passage index.
 *
 * Two-phase architecture:
 *   1. --rebuild (default): chunk narrative fields from drugbank_drugs → write drugbank_passage_chunks
 *   2. --embed:            load chunks → PGVectorStore.addDocuments() → drugbank_passage_embeddings
 *
 * Use --limit for smoke tests; it does not trigger a full import.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const dotenv = require('dotenv');
const { Client } = require('pg');
const { stableUuid } = require('./import-medicine-knowledge.ts');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const CHUNKABLE_FIELDS = [
  'description',
  'indication',
  'mechanism_of_action',
  'pharmacodynamics',
  'toxicity',
  'metabolism',
  'absorption',
  'half_life',
  'clearance',
];

const DEFAULT_MAX_CHUNK_LENGTH = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;
const INSERT_BATCH_SIZE = 500;

function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}.local`),
    override: true,
  });
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}`),
    override: true,
  });
  return nodeEnv;
}

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

function buildChunkId(drugbankId, field, index, sourceHash) {
  return stableUuid(
    'drugbank_passage_chunk',
    drugbankId,
    field,
    String(index),
    sourceHash,
  );
}

function computeSourceHash(rows) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) {
    hash.update(row.drugbank_id);
    hash.update(row.updated_at?.toISOString() ?? row.drugbank_id);
  }
  return hash.digest('hex').slice(0, 16);
}

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

async function loadDrugbankRows(client, sourceLimit) {
  const limitClause = sourceLimit != null ? `LIMIT ${sourceLimit}` : '';
  const result = await client.query(`
    SELECT
      drugbank_id,
      name,
      description,
      indication,
      mechanism_of_action,
      pharmacodynamics,
      toxicity,
      metabolism,
      absorption,
      half_life,
      clearance,
      updated_at
    FROM drugbank_drugs
    ORDER BY name ASC
    ${limitClause}
  `);
  return result.rows;
}

function buildChunks(rows, options) {
  const sourceHash = computeSourceHash(rows);
  const sourceVersion =
    options.sourceVersion ?? `rebuilt-${new Date().toISOString()}`;
  const chunks = [];

  for (const row of rows) {
    for (const field of CHUNKABLE_FIELDS) {
      const text = normalizeValue(row[field]);
      if (!text || text.trim().length === 0) {
        continue;
      }

      const fieldChunks = chunkText(
        text,
        options.maxChunkLength,
        options.chunkOverlap,
      );
      for (let index = 0; index < fieldChunks.length; index += 1) {
        chunks.push({
          id: buildChunkId(row.drugbank_id, field, index, sourceHash),
          drugbank_id: row.drugbank_id,
          source_field: field,
          chunk_text: fieldChunks[index],
          chunk_index: index,
          source_version: sourceVersion,
          source_hash: sourceHash,
        });
      }
    }
  }

  return chunks;
}

async function clearChunks(client) {
  const result = await client.query('DELETE FROM "drugbank_passage_chunks"');
  return result.rowCount;
}

async function insertChunks(client, chunks) {
  if (chunks.length === 0) {
    return 0;
  }

  const columns = [
    'id',
    'drugbank_id',
    'source_field',
    'chunk_text',
    'chunk_index',
    'source_version',
    'source_hash',
  ];

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

    const sql = `
      INSERT INTO "drugbank_passage_chunks" (
        "${columns.join('", "')}"
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT ("drugbank_id", "source_field", "chunk_index")
      DO UPDATE SET
        "chunk_text" = EXCLUDED."chunk_text",
        "source_version" = EXCLUDED."source_version",
        "source_hash" = EXCLUDED."source_hash",
        "updated_at" = CURRENT_TIMESTAMP
    `;

    const result = await client.query(sql, values);
    inserted += result.rowCount;
  }

  return inserted;
}

async function rebuild(client, options) {
  console.log('Loading DrugBank rows...');
  const rows = await loadDrugbankRows(client, options.sourceLimit);
  console.log(`Loaded ${rows.length} rows`);

  const chunks = buildChunks(rows, options);
  console.log(`Prepared ${chunks.length} chunks`);

  if (options.dryRun) {
    console.log('Dry run: no database writes');
    return {
      drugCount: rows.length,
      chunkCount: chunks.length,
      inserted: 0,
    };
  }

  console.log('Clearing existing chunks...');
  const deletedCount = await clearChunks(client);
  console.log(`Deleted ${deletedCount} existing chunks`);

  console.log('Inserting chunks...');
  const inserted = await insertChunks(client, chunks);
  console.log(`Inserted ${inserted} chunks`);

  return { drugCount: rows.length, chunkCount: chunks.length, inserted };
}

async function embedChunks(client, options) {
  const apiKey = process.env.AI_EMBEDDING_API_KEY?.trim();
  const baseUrl = process.env.AI_EMBEDDING_BASE_URL?.trim();
  const model = process.env.AI_EMBEDDING_MODEL?.trim();

  if (!apiKey || !baseUrl || !model) {
    console.error(
      'Embedding is not configured. Set AI_EMBEDDING_API_KEY, AI_EMBEDDING_BASE_URL, and AI_EMBEDDING_MODEL.',
    );
    return { embedded: 0 };
  }

  // Dynamic import for ESM-only packages
  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const { PGVectorStore } =
    await import('@langchain/community/vectorstores/pgvector');
  const { Pool } = await import('pg');

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
  });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for embedding.');
  }

  const pool = new Pool({ connectionString, max: 2 });

  const store = new PGVectorStore(embeddings, {
    pool,
    tableName: 'drugbank_passage_embeddings',
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'embedding',
      contentColumnName: 'document',
      metadataColumnName: 'cmetadata',
    },
    distanceStrategy: 'cosine',
  });

  await store.ensureTableInDatabase();

  if (options.embedForce) {
    console.log('Clearing existing embeddings (--embed-force)...');
    await pool.query('DELETE FROM drugbank_passage_embeddings');
  }

  // Load all chunks from drugbank_passage_chunks
  const limitClause =
    options.embedLimit != null ? `LIMIT ${options.embedLimit}` : '';
  const chunkResult = await client.query(`
    SELECT id, drugbank_id, source_field, chunk_text, chunk_index
    FROM drugbank_passage_chunks
    ORDER BY updated_at DESC, id ASC
    ${limitClause}
  `);
  const allChunks = chunkResult.rows;

  if (allChunks.length === 0) {
    console.log('No chunks found in drugbank_passage_chunks.');
    await pool.end();
    return { embedded: 0 };
  }

  // Load drug names for metadata enrichment
  const drugResult = await client.query(`
    SELECT drugbank_id, name FROM drugbank_drugs
  `);
  const drugNames = new Map();
  for (const row of drugResult.rows) {
    drugNames.set(row.drugbank_id, row.name);
  }

  // Build Document array
  const docs = allChunks.map((row) => ({
    pageContent: row.chunk_text,
    metadata: {
      chunkId: row.id,
      drugbankId: row.drugbank_id,
      drugName: drugNames.get(row.drugbank_id) ?? null,
      field: row.source_field,
      chunkIndex: row.chunk_index,
    },
  }));

  console.log(
    `Generating embeddings for ${docs.length} chunks (batch size: ${options.embedBatchSize})...`,
  );

  let embedded = 0;
  for (let i = 0; i < docs.length; i += options.embedBatchSize) {
    const batch = docs.slice(i, i + options.embedBatchSize);

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

    if (i + options.embedBatchSize < docs.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  await pool.end();
  return { embedded };
}

function parseArgs(argv) {
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

function printHelp() {
  console.log(`
Usage: node rebuild-drugbank-rag-index.ts [options]

Options:
  --max-chunk-length <n>  Max chunk length (default: ${DEFAULT_MAX_CHUNK_LENGTH})
  --chunk-overlap <n>     Chunk overlap (default: ${DEFAULT_CHUNK_OVERLAP})
  --source-version <v>    Version tag for the rebuild
  --limit <n>             Max source rows to process (default: all)
  --dry-run               Count chunks without writing
  --skip-rebuild          Skip chunk rebuild and only embed
  --embed                 Run embedding phase
  --embed-limit <n>       Max chunks to embed (default: all)
  --embed-batch-size <n>  Batch size for embedding (default: 20)
  --embed-force           Clear existing embeddings before re-embedding
  --help, -h              Show this help

Examples:
  node rebuild-drugbank-rag-index.ts --limit 100 --embed --embed-limit 100
  node rebuild-drugbank-rag-index.ts --dry-run --limit 100
  node rebuild-drugbank-rag-index.ts --skip-rebuild --embed --embed-limit 100
`);
}

async function main() {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseArgs(argv);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (!options.skipRebuild) {
      const summary = await rebuild(client, options);
      console.log(JSON.stringify({ ...summary, options }, null, 2));
    } else {
      console.log(
        JSON.stringify(
          {
            skippedRebuild: true,
            options,
          },
          null,
          2,
        ),
      );
    }

    if (options.embed) {
      const embedSummary = await embedChunks(client, options);
      console.log(JSON.stringify({ ...embedSummary }, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

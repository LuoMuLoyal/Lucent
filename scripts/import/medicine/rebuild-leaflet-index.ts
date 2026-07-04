#!/usr/bin/env node

const crypto = require('node:crypto');
const path = require('node:path');

const dotenv = require('dotenv');
const { Client } = require('pg');
const { getDotenvLoadOrder } = require('../../../src/config/env-file-paths');
const { stableUuid } = require('./import-medicine-knowledge.ts');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const CHUNKABLE_FIELDS = [
  'indications',
  'dosage',
  'contraindications',
  'precautions',
  'adverse_reactions',
  'drug_interactions',
  'pharmacology_toxicology',
  'pharmacokinetics',
  'storage',
  'validity_period',
];

const DEFAULT_MAX_CHUNK_LENGTH = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;
const INSERT_BATCH_SIZE = 500;

function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  for (const envPath of getDotenvLoadOrder()) {
    dotenv.config({
      path: path.join(REPO_ROOT, envPath),
      override: true,
    });
  }
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

function buildChunkId(leafletId, field, index, sourceHash) {
  return stableUuid(
    'medicine_leaflet_chunk',
    leafletId,
    field,
    String(index),
    sourceHash,
  );
}

function computeSourceHash(leaflets) {
  const hash = crypto.createHash('sha256');
  for (const leaflet of leaflets) {
    hash.update(leaflet.id);
    hash.update(leaflet.updated_at.toISOString());
  }
  return hash.digest('hex').slice(0, 16);
}

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

async function loadLeaflets(client) {
  return loadLeafletsWithLimit(client, null);
}

async function loadLeafletsWithLimit(client, sourceLimit) {
  const limitClause = sourceLimit != null ? `LIMIT ${sourceLimit}` : '';
  const result = await client.query(`
    SELECT
      "id",
      "instruction_id",
      "indications",
      "dosage",
      "contraindications",
      "precautions",
      "adverse_reactions",
      "drug_interactions",
      "pharmacology_toxicology",
      "pharmacokinetics",
      "storage",
      "validity_period",
      "updated_at"
    FROM "cn_medicine_leaflets"
    ORDER BY "updated_at" DESC, "id" ASC
    ${limitClause}
  `);
  return result.rows;
}

function buildChunks(leaflets, options) {
  const sourceHash = computeSourceHash(leaflets);
  const sourceVersion =
    options.sourceVersion ?? `rebuilt-${new Date().toISOString()}`;
  const chunks = [];

  for (const leaflet of leaflets) {
    for (const field of CHUNKABLE_FIELDS) {
      const text = normalizeValue(leaflet[field]);
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
          id: buildChunkId(leaflet.id, field, index, sourceHash),
          source_kind: 'cn',
          leaflet_id: leaflet.id,
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
  const result = await client.query('DELETE FROM "medicine_leaflet_chunks"');
  return result.rowCount;
}

async function insertChunks(client, chunks) {
  if (chunks.length === 0) {
    return 0;
  }

  const columns = [
    'id',
    'source_kind',
    'leaflet_id',
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
      INSERT INTO "medicine_leaflet_chunks" (
        "${columns.join('", "')}"
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT ("leaflet_id", "source_field", "chunk_index")
      DO UPDATE SET
        "source_kind" = EXCLUDED."source_kind",
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
  console.log('Loading leaflets...');
  const leaflets = await loadLeafletsWithLimit(client, options.sourceLimit);
  console.log(`Loaded ${leaflets.length} leaflets`);

  const chunks = buildChunks(leaflets, options);
  console.log(`Prepared ${chunks.length} chunks`);

  if (options.dryRun) {
    console.log('Dry run: no database writes');
    return {
      leafletCount: leaflets.length,
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

  return { leafletCount: leaflets.length, chunkCount: chunks.length, inserted };
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
    tableName: 'leaflet_embeddings',
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'embedding',
      contentColumnName: 'document',
      metadataColumnName: 'cmetadata',
    },
    distanceStrategy: 'cosine',
  });

  await store.ensureTableInDatabase();

  // Clear existing embeddings if --embed-force
  if (options.embedForce) {
    console.log('Clearing existing embeddings (--embed-force)...');
    await pool.query('DELETE FROM leaflet_embeddings');
  }

  // Load all chunks from medicine_leaflet_chunks
  const limitClause =
    options.embedLimit != null ? `LIMIT ${options.embedLimit}` : '';
  const chunkResult = await client.query(`
    SELECT mc.id, mc.leaflet_id, mc.source_field, mc.chunk_text, mc.chunk_index
    FROM medicine_leaflet_chunks mc
    ORDER BY mc.updated_at DESC, mc.id ASC
    ${limitClause}
  `);
  const allChunks = chunkResult.rows;

  if (allChunks.length === 0) {
    console.log('No chunks found in medicine_leaflet_chunks.');
    await pool.end();
    return { embedded: 0 };
  }

  // Load leaflet-to-product mappings for metadata enrichment
  const linkResult = await client.query(`
    SELECT l.leaflet_id, l.product_id, p.name
    FROM cn_medicine_product_leaflet_links
    l
    LEFT JOIN cn_medicine_products p ON p.id = l.product_id
  `);
  const leafletProducts = new Map();
  const leafletProductNames = new Map();
  for (const row of linkResult.rows) {
    const ids = leafletProducts.get(row.leaflet_id) ?? [];
    ids.push(row.product_id);
    leafletProducts.set(row.leaflet_id, ids);

    const names = leafletProductNames.get(row.leaflet_id) ?? [];
    if (row.name != null) {
      names.push(row.name);
    }
    leafletProductNames.set(row.leaflet_id, names);
  }

  // Build Document array
  const docs = allChunks.map((row) => ({
    pageContent: row.chunk_text,
    metadata: {
      leafletId: row.leaflet_id,
      sourceField: row.source_field,
      chunkIndex: row.chunk_index,
      chunkId: row.id,
      productIds: leafletProducts.get(row.leaflet_id) ?? [],
      productNames: leafletProductNames.get(row.leaflet_id) ?? [],
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
    if (part === '--source-limit') {
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

async function main() {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const options = parseArgs(process.argv.slice(2));
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

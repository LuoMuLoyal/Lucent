#!/usr/bin/env node

/**
 * Imports the alpaca_zh_demo.json medical Q&A dataset (~1.36M records, ~1.83 GB)
 * into the RAG pipeline.
 *
 * Two-phase architecture:
 *   1. --filter: stream-parse NDJSON → safety filter → write medical_qa_chunks
 *   2. --embed:  load chunks → PGVectorStore.addDocuments() → medical_qa_embeddings
 *
 * Prerequisite: convert the JSON array to NDJSON first:
 *   python -c "import json; data=json.load(open('alpaca_zh_demo.json')); [print(json.dumps(r,ensure_ascii=False)) for r in data]" > medical_qa.ndjson
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const dotenv = require('dotenv');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DRUG_DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const DEFAULT_SOURCE_PATH = path.join(
  DRUG_DATA_ROOT,
  '医疗问答数据集一共135万条',
  '数据集',
  'medical_qa.ndjson',
);

const FILTER_BATCH_SIZE = 500;
const MIN_ANSWER_LENGTH = 50;

// ── Safety filter ─────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  '处方',
  '药方',
  '剂量mg',
  '剂量g',
  '手术步骤',
  '注射剂量',
  '偏方',
  '祖传秘方',
  '自行用药',
  '自行配药',
];

const CAUTION_KEYWORDS = [
  '诊断',
  '确诊',
  '鉴别诊断',
  '治疗方案',
  '首选药物',
  '推荐用药',
  '遵医嘱',
  '请咨询医生',
  '需就医',
  '应立即就医',
];

function classifySafety(
  instruction: string,
  output: string,
): 'safe' | 'caution' | 'blocked' {
  const combined = `${instruction} ${output}`;

  for (const kw of BLOCKED_KEYWORDS) {
    if (combined.includes(kw)) return 'blocked';
  }

  for (const kw of CAUTION_KEYWORDS) {
    if (combined.includes(kw)) return 'caution';
  }

  return 'safe';
}

// ── Environment ────────────────────────────────────────────────

function loadEnvironment(): string {
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

// ── Phase 1: filter & write chunks ─────────────────────────────

interface QaRecord {
  id: string;
  instruction: string;
  output: string;
}

async function filterAndWrite(options: {
  sourcePath: string;
  limit?: number;
  client: ReturnType<typeof Client.prototype>;
}): Promise<{
  total: number;
  safe: number;
  caution: number;
  blocked: number;
  written: number;
}> {
  const { sourcePath, limit, client } = options;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const stats: {
    total: number;
    safe: number;
    caution: number;
    blocked: number;
    written: number;
  } = {
    total: 0,
    safe: 0,
    caution: 0,
    blocked: 0,
    written: 0,
  };

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS medical_qa_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      qa_id TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      safety_label TEXT NOT NULL CHECK (safety_label IN ('safe', 'caution', 'blocked')),
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Clear existing if re-importing
  const existingCount = await client.query(
    'SELECT count(*) FROM medical_qa_chunks',
  );
  if (Number(existingCount.rows[0].count) > 0) {
    console.log(`Clearing ${existingCount.rows[0].count} existing chunks...`);
    await client.query('DELETE FROM medical_qa_chunks');
  }

  const fileStream = fs.createReadStream(sourcePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let batch: QaRecord[] = [];

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const record of batch) {
      const label = classifySafety(record.instruction, record.output);
      stats[label] += 1;

      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      params.push(record.id, record.instruction, record.output, label);
      idx += 4;
    }

    await client.query(
      `INSERT INTO medical_qa_chunks (qa_id, question, answer, safety_label)
       VALUES ${values.join(', ')}
       ON CONFLICT (qa_id) DO UPDATE SET
         question = EXCLUDED.question,
         answer = EXCLUDED.answer,
         safety_label = EXCLUDED.safety_label`,
      params,
    );

    stats.written += batch.length;
    batch = [];
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const record: QaRecord = JSON.parse(trimmed);

      if (!record.id || !record.instruction || !record.output) continue;
      if ((record.output?.length ?? 0) < MIN_ANSWER_LENGTH) continue;

      batch.push(record);
      stats.total += 1;

      if (batch.length >= FILTER_BATCH_SIZE) {
        await flushBatch();
      }

      if (limit && stats.total >= limit) break;
    } catch {
      // Skip malformed lines
    }
  }

  await flushBatch();
  return stats;
}

// ── Phase 2: embed ─────────────────────────────────────────────

async function embedChunks(options: {
  client: ReturnType<typeof Client.prototype>;
  batchSize: number;
  force: boolean;
}): Promise<{ embedded: number }> {
  const apiKey = process.env.AI_EMBEDDING_API_KEY?.trim();
  const baseUrl = process.env.AI_EMBEDDING_BASE_URL?.trim();
  const model = process.env.AI_EMBEDDING_MODEL?.trim();

  if (!apiKey || !baseUrl || !model) {
    console.error(
      'Embedding not configured. Set AI_EMBEDDING_API_KEY, AI_EMBEDDING_BASE_URL, and AI_EMBEDDING_MODEL.',
    );
    return { embedded: 0 };
  }

  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const { PGVectorStore } =
    await import('@langchain/community/vectorstores/pgvector');
  const { Pool } = await import('pg');

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
  });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const store = new PGVectorStore(embeddings, {
    pool,
    tableName: 'medical_qa_embeddings',
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'embedding',
      contentColumnName: 'document',
      metadataColumnName: 'cmetadata',
    },
    distanceStrategy: 'cosine',
  });

  await store.ensureTableInDatabase();

  if (options.force) {
    console.log('Clearing existing embeddings...');
    await pool.query('DELETE FROM medical_qa_embeddings');
  }

  // Load safe + caution chunks only (skip blocked)
  const result = await options.client.query(
    `SELECT qa_id, question, answer, safety_label FROM medical_qa_chunks WHERE safety_label != 'blocked'`,
  );
  const rows = result.rows;

  if (rows.length === 0) {
    console.log('No chunks to embed.');
    await pool.end();
    return { embedded: 0 };
  }

  const docs = rows.map((row: any) => ({
    pageContent: row.answer,
    metadata: {
      qaId: row.qa_id,
      question: row.question,
      safetyLabel: row.safety_label,
    },
  }));

  console.log(
    `Embedding ${docs.length} QA chunks (batch size: ${options.batchSize})...`,
  );

  let embedded = 0;
  for (let i = 0; i < docs.length; i += options.batchSize) {
    const batch = docs.slice(i, i + options.batchSize);
    try {
      await store.addDocuments(batch);
      embedded += batch.length;
      console.log(
        `  ${embedded}/${docs.length} (${((embedded / docs.length) * 100).toFixed(1)}%)`,
      );
    } catch (error: any) {
      console.error(
        `  Batch ${i}-${i + batch.length} failed: ${error?.message ?? error}`,
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (i + options.batchSize < docs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  await pool.end();
  return { embedded };
}

// ── CLI ────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  sourcePath: string;
  limit?: number;
  filter: boolean;
  embed: boolean;
  embedBatchSize: number;
  embedForce: boolean;
  help: boolean;
} {
  const opts: ReturnType<typeof parseArgs> = {
    sourcePath: DEFAULT_SOURCE_PATH,
    filter: false,
    embed: false,
    embedBatchSize: 20,
    embedForce: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    switch (part) {
      case '--source':
        opts.sourcePath = argv[++i] ?? DEFAULT_SOURCE_PATH;
        break;
      case '--limit':
        opts.limit = Number(argv[++i]) || undefined;
        break;
      case '--filter':
        opts.filter = true;
        break;
      case '--embed':
        opts.embed = true;
        break;
      case '--embed-batch-size':
        opts.embedBatchSize = Number(argv[++i]) || 20;
        break;
      case '--embed-force':
        opts.embedForce = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
Usage: node import-medical-qa.ts [options]

Options:
  --source <path>        NDJSON source file (default: DrugDataBase/医疗问答数据集一共135万条/数据集/medical_qa.ndjson)
  --limit <n>            Max records to import (default: all)
  --filter               Run Phase 1: parse NDJSON → safety filter → write medical_qa_chunks
  --embed                Run Phase 2: load chunks → generate embeddings → medical_qa_embeddings
  --embed-batch-size <n> Batch size for embedding (default: 20)
  --embed-force          Clear existing embeddings before re-embedding
  --help, -h             Show this help

Examples:
  node import-medical-qa.ts --filter --limit 10000
  node import-medical-qa.ts --embed --embed-force
  node import-medical-qa.ts --filter --embed
`);
}

async function main(): Promise<void> {
  loadEnvironment();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.filter && !opts.embed)) {
    printHelp();
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (opts.filter) {
      console.log('=== Phase 1: Filter & Import ===');
      const stats = await filterAndWrite({
        sourcePath: opts.sourcePath,
        limit: opts.limit,
        client,
      });
      console.log(JSON.stringify(stats, null, 2));
    }

    if (opts.embed) {
      console.log('=== Phase 2: Embed ===');
      const embedStats = await embedChunks({
        client,
        batchSize: opts.embedBatchSize,
        force: opts.embedForce,
      });
      console.log(JSON.stringify(embedStats, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

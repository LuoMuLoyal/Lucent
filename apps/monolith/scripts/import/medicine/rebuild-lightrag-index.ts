#!/usr/bin/env node

/**
 * 中文散文检索灌入器 —— 把 chunk 表的事实源推进 LightRAG sidecar。
 *
 * 两个 workspace，各读各的 chunk 表：
 *
 *   --workspace=leaflet → `medicine_leaflet_chunks`（中文说明书字段级切分）
 *   --workspace=qa      → `medical_qa_chunks`（医学问答语料）
 *
 * 稳定 doc id 写进 `file_sources`，段序与查询侧
 * `LightragClientService.parseDocIdMetadata()` 的解析器**严格一致**：
 *
 *   leaflet:<leafletId>:<sourceField>:<chunkIndex>
 *   qa:<qaId>:<chunkIndex>
 *
 * 这个 doc id 是溯源的全部依据：查询侧靠它把命中映射回说明书字段 / 问答条目，
 * 解析不出来的命中会被标成 `coverage: partial`。改这里的段序等于切断溯源链。
 *
 * 幂等：`--reset` 先按 doc id 清空该 workspace 的全部文档再灌；不传则增量追加
 * （同 id 重灌由 LightRAG 判重复，不会产生第二份）。
 *
 * 用法：
 *   node scripts/import/medicine/rebuild-lightrag-index.ts --workspace=leaflet
 *   node scripts/import/medicine/rebuild-lightrag-index.ts --workspace=qa --limit=1000
 *   node scripts/import/medicine/rebuild-lightrag-index.ts --workspace=leaflet --reset
 *
 * 前置：chunk 表有数据（`rebuild-leaflet-index.ts` / `import-medical-qa.ts --filter`），
 * 且 sidecar 已启动（`docker compose -f compose.dev.yaml --profile lightrag up -d lightrag`）。
 */

import { Client } from 'pg';

import { loadEnvironment } from '../../shared/env.ts';

type Workspace = 'leaflet' | 'qa';

interface ChunkRow {
  text: string;
  fileSource: string;
}

/** 一次 POST 里塞多少个 chunk：太大容易撞 body 上限与网关超时。 */
const BATCH_SIZE = 25;

/** 灌入后等流水线跑干的轮询间隔与上限（建图模式下会很慢，故留足轮次）。 */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ROUNDS = 720;

const DEFAULT_BASE_URL = 'http://127.0.0.1:9621';

interface Options {
  workspace: Workspace;
  limit: number | null;
  reset: boolean;
  dryRun: boolean;
  baseUrl: string;
  apiKey: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    workspace: 'leaflet',
    limit: null,
    reset: false,
    dryRun: false,
    baseUrl: (process.env.LIGHTRAG_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    apiKey: process.env.LIGHTRAG_API_KEY ?? '',
  };

  for (const part of argv) {
    if (part.startsWith('--workspace=')) {
      const value = part.slice('--workspace='.length);
      if (value !== 'leaflet' && value !== 'qa') {
        throw new Error(`--workspace 必须是 leaflet 或 qa，收到 "${value}"`);
      }
      options.workspace = value;
      continue;
    }
    if (part.startsWith('--limit=')) {
      options.limit = Number(part.slice('--limit='.length)) || null;
      continue;
    }
    if (part === '--reset') {
      options.reset = true;
      continue;
    }
    if (part === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage: node rebuild-lightrag-index.ts [options]

Options:
  --workspace=<name>  leaflet | qa (default: leaflet)
  --limit=<n>         Max chunks to ingest (default: all)
  --reset             Delete every document in the workspace first (idempotent re-ingest)
  --dry-run           Print the first stable doc id without writing
  --help, -h          Show this help

Environment:
  DATABASE_URL          chunk table source (fact source)
  LIGHTRAG_BASE_URL     sidecar base URL (default: ${DEFAULT_BASE_URL})
  LIGHTRAG_API_KEY      sidecar API key (X-API-Key)
`);
}

async function api(
  options: Options,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers: {
      'X-API-Key': options.apiKey,
      'LIGHTRAG-WORKSPACE': options.workspace,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

/**
 * 从 chunk 表读事实源，映射成 LightRAG 文档。
 *
 * doc id 段序是契约（见文件头注释），两个 workspace 各有一套。
 */
async function loadChunks(options: Options): Promise<ChunkRow[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (options.workspace === 'leaflet') {
      const { rows } = await client.query<{
        leaflet_id: string;
        source_field: string;
        chunk_text: string;
        chunk_index: number;
      }>(
        `
          SELECT leaflet_id, source_field, chunk_text, chunk_index
          FROM medicine_leaflet_chunks
          ORDER BY leaflet_id, source_field, chunk_index
          ${options.limit != null ? 'LIMIT $1' : ''}
        `,
        options.limit != null ? [options.limit] : [],
      );

      return rows.map((row) => ({
        text: row.chunk_text,
        fileSource: `leaflet:${row.leaflet_id}:${row.source_field}:${String(row.chunk_index)}`,
      }));
    }

    // qa：只灌未被安全过滤器拦下的条目（blocked 不进检索层）。
    const { rows } = await client.query<{
      qa_id: string;
      question: string;
      answer: string;
    }>(
      `
        SELECT qa_id, question, answer
        FROM medical_qa_chunks
        WHERE safety_label != 'blocked'
        ORDER BY qa_id
        ${options.limit != null ? 'LIMIT $1' : ''}
      `,
      options.limit != null ? [options.limit] : [],
    );

    // 问 + 答整条进一个文档：问答的可检索语义在答句里，但问句是它的检索锚点，
    // 拆开会丢掉"这个问题问的是什么"这条线索。
    return rows.map((row) => ({
      text: `问：${row.question}\n答：${row.answer}`,
      fileSource: `qa:${row.qa_id}:0`,
    }));
  } finally {
    await client.end();
  }
}

/**
 * 列出 workspace 里的文档。
 *
 * 上游没有 `GET /documents`（只有 DELETE），要用 POST `/documents/paginated`
 * ——这是 `--reset` 幂等清空的依据，也是灌完后统计 docStatus 的依据。
 */
async function listDocuments(
  options: Options,
): Promise<Array<{ id?: string }>> {
  const pageSize = 200;
  const all: Array<{ id?: string }> = [];

  for (let page = 1; ; page += 1) {
    const payload = (await api(options, '/documents/paginated', {
      method: 'POST',
      body: JSON.stringify({
        page,
        page_size: pageSize,
        sort_field: 'id',
        sort_direction: 'asc',
      }),
    })) as {
      documents?: Array<{ id?: string }>;
      pagination?: { total_count?: number };
    } | null;

    const items = payload?.documents ?? [];
    all.push(...items);
    const total = payload?.pagination?.total_count ?? all.length;
    if (items.length === 0 || all.length >= total) {
      break;
    }
  }

  return all;
}

async function resetWorkspace(options: Options): Promise<number> {
  const listed = await listDocuments(options);
  const docIds = listed
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (docIds.length === 0) {
    console.log('[reset] workspace 已空');
    return 0;
  }

  let deleted = 0;
  for (let index = 0; index < docIds.length; index += BATCH_SIZE) {
    const batch = docIds.slice(index, index + BATCH_SIZE);
    await api(options, '/documents/delete_document', {
      method: 'POST',
      body: JSON.stringify({ doc_ids: batch }),
    });
    deleted += batch.length;
    console.log(`[reset] 删除 ${String(deleted)}/${String(docIds.length)}`);
  }

  return deleted;
}

async function waitForPipeline(options: Options): Promise<void> {
  for (let round = 1; round <= POLL_MAX_ROUNDS; round += 1) {
    const status = (await api(options, '/documents/pipeline_status')) as {
      pipeline_busy?: boolean;
      busy?: boolean;
      job_queue?: unknown;
      pending?: unknown;
    } | null;

    if (!status?.pipeline_busy && !status?.busy) {
      const pending = status?.job_queue ?? status?.pending ?? null;
      console.log(
        `[pipeline] 空闲（第 ${String(round)} 轮），队列=${JSON.stringify(pending)}`,
      );
      return;
    }

    console.log(`[pipeline] 仍在处理（第 ${String(round)} 轮）…`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    'pipeline 超时未跑干——用 /documents/pipeline_status 与 docStatus 表继续排查',
  );
}

async function main(): Promise<void> {
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
  console.log(
    `[config] workspace=${options.workspace} baseUrl=${options.baseUrl} limit=${String(options.limit ?? 'all')}`,
  );

  const chunks = await loadChunks(options);
  console.log(`[source] 读到 ${String(chunks.length)} 个 chunk`);
  if (chunks.length === 0) {
    throw new Error(
      options.workspace === 'leaflet'
        ? 'medicine_leaflet_chunks 为空——先跑 rebuild-leaflet-index.ts'
        : 'medical_qa_chunks 为空——先跑 import-medical-qa.ts --filter',
    );
  }

  if (options.dryRun) {
    console.log(
      '[dry-run] 首个稳定 doc id:',
      chunks[0]?.fileSource ?? '(none)',
    );
    return;
  }

  if (options.apiKey.length === 0) {
    throw new Error(
      'LIGHTRAG_API_KEY 未配置——必须与 deploy/lightrag/.env 里的同名项一致（鉴权握手）',
    );
  }

  if (options.reset) {
    await resetWorkspace(options);
  }

  for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
    const batch = chunks.slice(index, index + BATCH_SIZE);
    await api(options, '/documents/texts', {
      method: 'POST',
      body: JSON.stringify({
        texts: batch.map((chunk) => chunk.text),
        file_sources: batch.map((chunk) => chunk.fileSource),
      }),
    });
    console.log(
      `[import] 已提交 ${String(Math.min(index + BATCH_SIZE, chunks.length))}/${String(chunks.length)}`,
    );
  }

  await waitForPipeline(options);

  const documents = await listDocuments(options);
  const byStatus = documents.reduce<Record<string, number>>((acc, entry) => {
    const key =
      typeof (entry as { status?: unknown }).status === 'string'
        ? ((entry as { status: string }).status ?? 'unknown')
        : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log('[result] docStatus 分布:', JSON.stringify(byStatus));
  console.log(
    `[result] workspace=${options.workspace} 文档数=${String(documents.length)}`,
  );
  console.log(
    '[next] 失败文档用 POST /documents/reprocess_failed 重试；运维手册见 docs/reference/deployment.md',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

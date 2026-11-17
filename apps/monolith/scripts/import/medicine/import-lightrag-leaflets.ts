#!/usr/bin/env node

/**
 * 常见药说明书 → LightRAG 知识图谱灌入器（可断点续传）。
 *
 * ── 与 `rebuild-lightrag-index.ts` 的区别（为什么另写一个）──────────
 * 那个脚本按 **chunk 表** 逐条灌，把一份说明书拆成几十个独立文档；它的
 * `--limit` 截的是 chunk 数，且灌完只等一次 pipeline。这在本任务里有两个
 * 硬伤：
 *
 *   1. **断点续传没有原子单位** —— 中断后无法回答"哪份说明书灌完了"，
 *      只有"第 N 个 chunk 灌到哪"，而 chunk 顺序与说明书边界无关。
 *   2. `--limit=10` 不等于 10 份说明书（10 个 chunk 连一份都不到）。
 *
 * 本脚本以 **一份说明书 = 一个 LightRAG 文档** 为原子单位：
 *   file_source = `leaflet:<leafletId>`
 * LightRAG 自己按 token 切 chunk（`recursive_character`），段序不影响溯源，
 * 因为 `leaflet:<id>` 前缀已足够让查询侧定位到说明书。
 *
 * ── 断点续传的三层依据（从可信到最快）────────────────────────────
 *   ① 服务端 doc_status（事实源）：`/documents/paginated` 按 `file_path`
 *      取回该 leaflet 的文档状态。status=processed 才算完成。
 *   ② 本地账本 JSONL（快照）：每完成一份追加一行，含 track_id、
 *      chunks_count、时间。作用是中断后**不必全量拉服务端**就能续跑，
 *      以及留下审计轨迹。账本与①冲突时**以①为准**。
 *   ③ `--force` 显式忽略以上两者重灌。
 * 为什么不能只靠②：账本在本地，中途换机器/删文件就丢了；而 LightRAG 的
 * doc_status 在 Postgres 里，重启容器也不会丢。②只是①的缓存。
 *
 * 幂等：LightRAG 对同 `file_source` 重复插入会抛 409（同名冲突），本脚本
 * 把它当作"已完成"而非错误——这正是续传能安全重跑的原因。
 *
 * 用法：
 *   node scripts/import/medicine/import-lightrag-leaflets.ts --limit=10
 *   node scripts/import/medicine/import-lightrag-leaflets.ts --from-file=targets.tsv
 *   node scripts/import/medicine/import-lightrag-leaflets.ts --status
 *   node scripts/import/medicine/import-lightrag-leaflets.ts --resume-only
 *
 * 前置：`cn_medicine_leaflets` 有数据，sidecar 已启动。
 */

import fs from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { loadEnvironment, REPO_ROOT } from '../../shared/env.ts';

/** 会被拼进文档正文的字段，顺序即正文顺序（与说明书排版一致）。 */
const DOC_FIELDS: Array<[string, string]> = [
  ['indications', '适应症'],
  ['dosage', '用法用量'],
  ['contraindications', '禁忌'],
  ['precautions', '注意事项'],
  ['adverse_reactions', '不良反应'],
  ['drug_interactions', '药物相互作用'],
  ['pharmacology_toxicology', '药理毒理'],
  ['pharmacokinetics', '药代动力学'],
  ['pregnancy_lactation', '孕妇及哺乳期妇女用药'],
  ['pediatric_use', '儿童用药'],
  ['geriatric_use', '老年用药'],
  ['storage', '贮藏'],
  ['validity_period', '有效期'],
];

/** 一次 POST 提交几份说明书。LightRAG 后台异步抽取，故不必太小。 */
const DEFAULT_BATCH = 4;

/** 轮询间隔：抽取一份约 10~30 s，5 s 粒度足够且不吵服务端。 */
const POLL_INTERVAL_MS = 10_000;

const DEFAULT_BASE_URL = 'http://127.0.0.1:9621';
const DEFAULT_LEDGER = 'scripts/import/medicine/.lightrag-leaflet-ledger.jsonl';

interface Options {
  limit: number | null;
  fromFile: string | null;
  baseUrl: string;
  apiKey: string;
  workspace: string;
  ledgerPath: string;
  batch: number;
  force: boolean;
  statusOnly: boolean;
  resumeOnly: boolean;
  timeoutMs: number;
}

interface LedgerEntry {
  leafletId: string;
  genericName: string;
  docId: string;
  chunksCount: number | null;
  trackId: string | null;
  at: string;
}

interface DocStatus {
  id?: string;
  status?: string;
  file_path?: string;
  chunks_count?: number | null;
  track_id?: string | null;
  error_msg?: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    limit: null,
    fromFile: null,
    baseUrl: (process.env.LIGHTRAG_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    apiKey: process.env.LIGHTRAG_API_KEY ?? '',
    workspace: process.env.LIGHTRAG_WORKSPACE_LEAFLET ?? 'leaflet',
    ledgerPath: path.join(REPO_ROOT, DEFAULT_LEDGER),
    batch: DEFAULT_BATCH,
    force: false,
    statusOnly: false,
    resumeOnly: false,
    timeoutMs: 6 * 60 * 60 * 1000,
  };

  for (const part of argv) {
    if (part.startsWith('--limit=')) {
      options.limit = Number(part.slice('--limit='.length)) || null;
    } else if (part.startsWith('--from-file=')) {
      options.fromFile = part.slice('--from-file='.length);
    } else if (part.startsWith('--base-url=')) {
      options.baseUrl = part.slice('--base-url='.length).replace(/\/+$/, '');
    } else if (part.startsWith('--workspace=')) {
      options.workspace = part.slice('--workspace='.length);
    } else if (part.startsWith('--ledger=')) {
      options.ledgerPath = path.resolve(part.slice('--ledger='.length));
    } else if (part.startsWith('--batch=')) {
      options.batch = Math.max(1, Number(part.slice('--batch='.length)) || 1);
    } else if (part.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(part.slice('--timeout-ms='.length)) || 0;
    } else if (part === '--force') {
      options.force = true;
    } else if (part === '--status') {
      options.statusOnly = true;
    } else if (part === '--resume-only') {
      options.resumeOnly = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage: node import-lightrag-leaflets.ts [options]

一份说明书 = 一个 LightRAG 文档（file_source = leaflet:<id>）。

Options:
  --limit=<n>        最多灌入几份说明书（默认：--from-file 的全部，否则全库）
  --from-file=<path> 目标清单 TSV（第 1 列 leaflet_id，第 2 列可读名）
  --batch=<n>        一次 POST 提交几份（默认 ${String(DEFAULT_BATCH)}）
  --ledger=<path>    本地账本 JSONL 路径（默认 ${DEFAULT_LEDGER}）
  --workspace=<name> LightRAG workspace（默认 leaflet）
  --base-url=<url>   sidecar 地址（默认 ${DEFAULT_BASE_URL}）
  --timeout-ms=<n>   等待 pipeline 的总超时（默认 6h）
  --force            忽略账本与服务端状态，强制重灌
  --status           只打印进度，不灌入
  --resume-only      只等待/补齐已提交但未完成的文档，不提交新的
  --help, -h         显示帮助

Environment:
  DATABASE_URL       事实源（cn_medicine_leaflets）
  LIGHTRAG_API_KEY   sidecar 握手 key
`);
}

async function api<T>(
  options: Options,
  apiPath: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${options.baseUrl}${apiPath}`, {
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
    const error = new Error(
      `${apiPath} → ${response.status}: ${text.slice(0, 400)}`,
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return (text.length > 0 ? JSON.parse(text) : null) as T;
}

// ─── 事实源 ───────────────────────────────────────────────────

interface LeafletRow {
  id: string;
  generic_name: string | null;
  brand_name: string | null;
  manufacturer: string | null;
  category: string | null;
  [key: string]: unknown;
}

/**
 * 把一行说明书拼成一段有结构的正文。
 *
 * ⚠️ 保留字段标题（【适应症】这类）不是装饰：抽取模型要靠它判断
 * 「禁忌」里的药名是禁忌而不是适应症。去掉标题实测会让
 * 同一药名在禁忌与适应症之间产生语义矛盾的关系。
 */
function buildDocument(row: LeafletRow): string {
  const head: string[] = [];
  const name = (row.generic_name ?? '').trim();
  if (name) {
    head.push(`药品通用名：${name}`);
  }
  const brand = (row.brand_name ?? '').trim();
  if (brand) {
    head.push(`商品名：${brand}`);
  }
  const manufacturer = (row.manufacturer ?? '').trim();
  if (manufacturer) {
    head.push(`生产企业：${manufacturer}`);
  }
  const category = (row.category ?? '').trim();
  if (category) {
    head.push(`类别：${category}`);
  }

  const body: string[] = [];
  for (const [field, label] of DOC_FIELDS) {
    const raw = row[field];
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text.length === 0) {
      continue;
    }
    body.push(`【${label}】${text}`);
  }

  // 标题行 + 正文：用换行分隔，LightRAG 的 recursive_character 按段落切。
  return `${head.join('\n')}\n\n${body.join('\n\n')}`;
}

async function loadLeaflets(options: Options): Promise<LeafletRow[]> {
  const columns = [
    'id',
    'generic_name',
    'brand_name',
    'manufacturer',
    'category',
    ...DOC_FIELDS.map(([field]) => field),
  ];

  // 有 --from-file 时按清单顺序灌（清单本身已按常见药排序），
  // 用 = ANY 取回后按清单顺序重排——SQL 不保证 IN 的顺序。
  if (options.fromFile) {
    const raw = fs.readFileSync(options.fromFile, 'utf-8');
    const ids = raw
      .split(/\r?\n/)
      .map((line) => line.split('\t')[0]?.trim() ?? '')
      .filter(
        (id) => id.length > 0 && id !== 'leaflet_id' && !id.startsWith('#'),
      );
    if (ids.length === 0) {
      throw new Error(`${options.fromFile} 里没读到 leaflet_id`);
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<LeafletRow>(
        `SELECT ${columns.map((c) => `"${c}"`).join(', ')}
         FROM "cn_medicine_leaflets" WHERE "id" = ANY($1)`,
        [ids],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((row): row is LeafletRow => row !== undefined);
      if (ordered.length !== ids.length) {
        console.log(
          `[warn] 清单 ${String(ids.length)} 条，库内命中 ${String(ordered.length)} 条`,
        );
      }
      return options.limit != null ? ordered.slice(0, options.limit) : ordered;
    } finally {
      await client.end();
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<LeafletRow>(
      `SELECT ${columns.map((c) => `"${c}"`).join(', ')}
       FROM "cn_medicine_leaflets"
       ORDER BY "generic_name", "id"
       ${options.limit != null ? 'LIMIT $1' : ''}`,
      options.limit != null ? [options.limit] : [],
    );
    return rows;
  } finally {
    await client.end();
  }
}

// ─── 服务端状态（断点续传的事实源）────────────────────────────

/**
 * 拉回 workspace 全部文档状态，按 doc_id 建索引。
 *
 * doc_id 即 `file_path`（LightRAG 对纯文本插入时用 file_source 当 doc id）。
 * 文档多时要翻很多页，所以只在启动时拉一次，之后靠 track_id 增量轮询。
 */
async function fetchAllDocs(options: Options): Promise<Map<string, DocStatus>> {
  const pageSize = 200;
  const byId = new Map<string, DocStatus>();

  for (let page = 1; ; page += 1) {
    const payload = await api<{
      documents?: DocStatus[];
      pagination?: { total_count?: number };
    }>(options, '/documents/paginated', {
      method: 'POST',
      body: JSON.stringify({
        page,
        page_size: pageSize,
        sort_field: 'id',
        sort_direction: 'asc',
      }),
    });

    const items = payload?.documents ?? [];
    for (const item of items) {
      const key = item.file_path ?? item.id;
      if (typeof key === 'string' && key.length > 0) {
        byId.set(key, item);
      }
    }
    const total = payload?.pagination?.total_count ?? byId.size;
    if (items.length === 0 || byId.size >= total) {
      break;
    }
  }

  return byId;
}

/** 读本地账本，返回已记录的 leafletId 集合。 */
function readLedger(ledgerPath: string): Map<string, LedgerEntry> {
  const map = new Map<string, LedgerEntry>();
  if (!fs.existsSync(ledgerPath)) {
    return map;
  }
  const raw = fs.readFileSync(ledgerPath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed) as LedgerEntry;
      if (entry.leafletId) {
        map.set(entry.leafletId, entry);
      }
    } catch {
      // 半行写入（进程被杀）——跳过即可，服务端状态才是事实源。
    }
  }
  return map;
}

function appendLedger(ledgerPath: string, entry: LedgerEntry): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

// ─── 主流程 ───────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvironment();

  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const options = parseArgs(argv);
  console.log(
    `[config] workspace=${options.workspace} baseUrl=${options.baseUrl} batch=${String(options.batch)} ledger=${path.relative(REPO_ROOT, options.ledgerPath)}`,
  );

  const documents = await fetchAllDocs(options);
  const ledger = readLedger(options.ledgerPath);
  console.log(
    `[state] 服务端文档 ${String(documents.size)} 个，本地账本 ${String(ledger.size)} 条`,
  );

  if (options.statusOnly) {
    const done = [...documents.entries()].filter(
      ([, doc]) => doc.status === 'processed',
    ).length;
    const failed = [...documents.entries()].filter(
      ([, doc]) => doc.status === 'failed',
    ).length;
    const pending = documents.size - done - failed;
    console.log(
      `[status] processed=${String(done)} failed=${String(failed)} 其它=${String(pending)}`,
    );
    return;
  }

  const leaflets = await loadLeaflets(options);
  console.log(`[source] 目标说明书 ${String(leaflets.length)} 份`);

  // 已完成的判定：服务端 processed 优先；服务端没记录但账本有，也先算候选，
  // 由下一步的 409/查状态复核（账本可能是半写）。
  const isDone = (leafletId: string): boolean => {
    if (options.force) {
      return false;
    }
    const doc = documents.get(`leaflet:${leafletId}`);
    if (doc) {
      return doc.status === 'processed';
    }
    return ledger.has(leafletId);
  };

  const todo = leaflets.filter((row) => !isDone(row.id));
  const already = leaflets.length - todo.length;
  console.log(
    `[plan] 待灌 ${String(todo.length)} 份，已完成 ${String(already)} 份${options.force ? '（--force 已忽略完成状态）' : ''}`,
  );

  if (todo.length === 0 && !options.resumeOnly) {
    console.log('[done] 目标集已全部灌入，无需动作');
    return;
  }

  if (!options.resumeOnly) {
    if (options.apiKey.length === 0) {
      throw new Error(
        'LIGHTRAG_API_KEY 未配置——必须与 deploy/lightrag/.env 里的同名项一致（鉴权握手）',
      );
    }

    let submitted = 0;
    let skipped = 0;

    for (let index = 0; index < todo.length; index += options.batch) {
      const batch = todo.slice(index, index + options.batch);
      const texts = batch.map((row) => buildDocument(row));
      const sources = batch.map((row) => `leaflet:${row.id}`);

      let payload: { track_id?: string; status?: string; message?: string };
      try {
        payload = await api<{
          track_id?: string;
          status?: string;
          message?: string;
        }>(options, '/documents/texts', {
          method: 'POST',
          body: JSON.stringify({ texts, file_sources: sources }),
        });
      } catch (error) {
        // 409 = 同 file_source 已存在。这不是错误，是"已完成"的另一种表达。
        const status = (error as Error & { status?: number }).status;
        if (status === 409) {
          console.log(
            `[skip] 批次 ${String(index / options.batch + 1)} 已存在（409），逐份标记完成`,
          );
          for (const row of batch) {
            appendLedger(options.ledgerPath, {
              leafletId: row.id,
              genericName: (row.generic_name ?? '').trim(),
              docId: `leaflet:${row.id}`,
              chunksCount: null,
              trackId: null,
              at: new Date().toISOString(),
            });
          }
          skipped += batch.length;
          continue;
        }
        throw error;
      }

      const trackId = payload?.track_id ?? null;
      console.log(
        `[submit] ${String(Math.min(index + options.batch, todo.length))}/${String(todo.length)} ` +
          `track=${trackId ?? '-'}（${batch.map((row) => (row.generic_name ?? row.id).trim()).join('、')}）`,
      );
      submitted += batch.length;

      // 记账：提交即写，status 由后面的轮询回填。
      for (const row of batch) {
        appendLedger(options.ledgerPath, {
          leafletId: row.id,
          genericName: (row.generic_name ?? '').trim(),
          docId: `leaflet:${row.id}`,
          chunksCount: null,
          trackId,
          at: new Date().toISOString(),
        });
      }
    }

    console.log(
      `[submit] 本轮提交 ${String(submitted)} 份，跳过已存在 ${String(skipped)} 份`,
    );
  }

  // ── 等待跑干 ──────────────────────────────────────────────
  const deadline = Date.now() + options.timeoutMs;
  const targets = leaflets.map((row) => `leaflet:${row.id}`);

  for (;;) {
    const current = await fetchAllDocs(options);
    const counts = { processed: 0, failed: 0, running: 0, missing: 0 };
    const failures: Array<[string, string]> = [];

    for (const docId of targets) {
      const doc = current.get(docId);
      if (!doc) {
        counts.missing += 1;
      } else if (doc.status === 'processed') {
        counts.processed += 1;
      } else if (doc.status === 'failed') {
        counts.failed += 1;
        failures.push([docId, doc.error_msg ?? '(无错误信息)']);
      } else {
        counts.running += 1;
      }
    }

    console.log(
      `[progress] processed=${String(counts.processed)} failed=${String(counts.failed)} ` +
        `进行中=${String(counts.running)} 未见=${String(counts.missing)} / 目标 ${String(targets.length)}`,
    );

    if (counts.running === 0) {
      if (failures.length > 0) {
        console.log('\n[failed] 失败文档：');
        for (const [docId, message] of failures.slice(0, 20)) {
          console.log(`  ${docId}: ${message.slice(0, 200)}`);
        }
        console.log(
          '\n[next] 用 POST /documents/reprocess_failed 重试，然后本脚本 --resume-only 复核',
        );
      }
      console.log(
        `\n[result] 完成 ${String(counts.processed)}/${String(targets.length)}，失败 ${String(counts.failed)}`,
      );
      break;
    }

    if (Date.now() > deadline) {
      console.log(
        '\n[timeout] 等待超时——直接重跑本脚本即可续传（已完成的不重灌）',
      );
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
